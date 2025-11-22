import { assertEquals } from "@std/assert";
import { defaultEntryPointResolver } from "./graph_resolver.ts";
import type { FileSystemPort } from "../../core/ports.ts";
import type { ProjectInfo } from "../../core/types.ts";

function createMockFs(existingFiles: Set<string>): FileSystemPort {
  return {
    fileExists: (path: string) => Promise.resolve(existingFiles.has(path)),
    readJson: <T>() => Promise.resolve({} as T),
    writeJson: () => Promise.resolve(),
    readText: () => Promise.resolve(""),
    writeText: () => Promise.resolve(),
  };
}

function createProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "@test/pkg",
    root: "/repo/packages/pkg",
    relativeRoot: "packages/pkg",
    packageJson: { name: "@test/pkg" },
    workspaceType: "shared-package",
    workspaceSubType: "library",
    isPrivate: false,
    ...overrides,
  };
}

Deno.test("entry point resolver: prefers TypeScript source when it exists", async () => {
  const project = createProject();
  const fs = createMockFs(new Set(["/repo/packages/pkg/src/index.ts"]));

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "src/index.ts");
  assertEquals(entryPoint.exists, true);
  assertEquals(entryPoint.isTypeDefinition, false);
});

Deno.test("entry point resolver: uses src/index.tsx if src/index.ts doesn't exist", async () => {
  const project = createProject();
  const fs = createMockFs(new Set(["/repo/packages/pkg/src/index.tsx"]));

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "src/index.tsx");
  assertEquals(entryPoint.exists, true);
  assertEquals(entryPoint.isTypeDefinition, false);
});

Deno.test("entry point resolver: falls back to types field when no TS source", async () => {
  const project = createProject({
    packageJson: { name: "@test/pkg", types: "dist/index.d.ts" },
  });
  const fs = createMockFs(new Set(["/repo/packages/pkg/dist/index.d.ts"]));

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "dist/index.d.ts");
  assertEquals(entryPoint.exists, true);
  assertEquals(entryPoint.isTypeDefinition, true);
});

Deno.test("entry point resolver: uses typings field if types not present", async () => {
  const project = createProject({
    packageJson: { name: "@test/pkg", typings: "lib/index.d.ts" },
  });
  const fs = createMockFs(new Set(["/repo/packages/pkg/lib/index.d.ts"]));

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "lib/index.d.ts");
  assertEquals(entryPoint.exists, true);
  assertEquals(entryPoint.isTypeDefinition, true);
});

Deno.test("entry point resolver: uses exports field (string)", async () => {
  const project = createProject({
    packageJson: { name: "@test/pkg", exports: "./dist/index.js" },
  });
  const fs = createMockFs(new Set(["/repo/packages/pkg/dist/index.js"]));

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "./dist/index.js");
  assertEquals(entryPoint.exists, true);
  assertEquals(entryPoint.isTypeDefinition, false);
});

Deno.test("entry point resolver: uses exports field (object with .)", async () => {
  const project = createProject({
    packageJson: {
      name: "@test/pkg",
      exports: { ".": "./dist/main.js" },
    },
  });
  const fs = createMockFs(new Set(["/repo/packages/pkg/dist/main.js"]));

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "./dist/main.js");
  assertEquals(entryPoint.exists, true);
});

Deno.test("entry point resolver: handles nested conditional exports", async () => {
  const project = createProject({
    packageJson: {
      name: "@test/pkg",
      exports: {
        ".": {
          import: "./dist/index.js",
          require: "./dist/index.cjs",
          types: "./dist/index.d.ts",
        },
      },
    },
  });
  const fs = createMockFs(new Set(["/repo/packages/pkg/dist/index.js"]));

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "./dist/index.js");
  assertEquals(entryPoint.exists, true);
  assertEquals(entryPoint.isTypeDefinition, false);
});

Deno.test("entry point resolver: uses main field when no other options", async () => {
  const project = createProject({
    packageJson: { name: "@test/pkg", main: "lib/index.js" },
  });
  const fs = createMockFs(new Set(["/repo/packages/pkg/lib/index.js"]));

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "lib/index.js");
  assertEquals(entryPoint.exists, true);
});

Deno.test("entry point resolver: prefers module over main", async () => {
  const project = createProject({
    packageJson: {
      name: "@test/pkg",
      main: "lib/index.js",
      module: "esm/index.js",
    },
  });
  const fs = createMockFs(
    new Set([
      "/repo/packages/pkg/lib/index.js",
      "/repo/packages/pkg/esm/index.js",
    ]),
  );

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "esm/index.js");
  assertEquals(entryPoint.exists, true);
});

Deno.test("entry point resolver: returns fallback convention when nothing configured", async () => {
  const project = createProject();
  const fs = createMockFs(new Set([])); // No files exist

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "src/index.ts");
  assertEquals(entryPoint.exists, false, "should mark as not existing");
});

Deno.test("entry point resolver: marks configured entry as non-existent if file missing", async () => {
  const project = createProject({
    packageJson: { name: "@test/pkg", main: "dist/index.js" },
  });
  const fs = createMockFs(new Set([])); // File doesn't exist

  const entryPoint = await defaultEntryPointResolver(project, fs);

  assertEquals(entryPoint.path, "dist/index.js");
  assertEquals(entryPoint.exists, false, "should mark as not existing");
});
