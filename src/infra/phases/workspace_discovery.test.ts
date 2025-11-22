import { join } from "@std/path";
import { createWorkspaceDiscovery } from "./workspace_discovery.ts";
import type { FileSystemPort, LoggerPort } from "../../core/ports.ts";
import type {
  PackageJson,
  RepoManagerOptions,
  SyncConfig,
} from "../../core/types.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    message ?? `Expected ${expectedJson} but received ${actualJson}`,
  );
}

class InMemoryFileSystem implements FileSystemPort {
  #files = new Map<string, string>();

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [path, contents] of Object.entries(initialFiles)) {
      this.#files.set(path, contents);
    }
  }

  readJson<T>(path: string): Promise<T> {
    return Promise.resolve(JSON.parse(this.#files.get(path) ?? "{}") as T);
  }

  writeJson(): Promise<void> {
    return Promise.resolve();
  }

  fileExists(path: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(path));
  }

  readText(path: string): Promise<string> {
    return Promise.resolve(this.#files.get(path) ?? "");
  }

  writeText(): Promise<void> {
    return Promise.resolve();
  }
}

function createLogger(): LoggerPort & { infos: string[]; warnings: string[] } {
  const infos: string[] = [];
  const warnings: string[] = [];
  return {
    infos,
    warnings,
    phase: () => {},
    info: (msg) => infos.push(msg),
    warn: (msg) => warnings.push(msg),
    error: () => {},
    debug: () => {},
    getWarnings: () => [...warnings],
  };
}

function setupRepo(files: Record<string, unknown>): InMemoryFileSystem {
  const serialized: Record<string, string> = {};
  for (const [path, contents] of Object.entries(files)) {
    serialized[path] = typeof contents === "string"
      ? contents
      : JSON.stringify(contents);
  }
  return new InMemoryFileSystem(serialized);
}

const baseOptions: RepoManagerOptions = {
  rootDir: "/repo",
};

const baseConfig: SyncConfig = {
  workspaceTypes: {
    "apps/*": { type: "app", subType: "website" },
    "packages/*": { type: "shared-package" },
  },
};

type GlobMap = Record<string, string[]>;

function createStubGlob(map: GlobMap) {
  return async function* (pattern: string) {
    for (const path of map[pattern] ?? []) {
      yield {
        path,
        name: path.split("/").pop() ?? "",
        isFile: true,
      };
    }
  };
}

function workspaceGlobPattern(pattern: string): string {
  const searchPattern = pattern.includes("*") ? pattern : `${pattern}/*`;
  return join(baseOptions.rootDir, searchPattern, "package.json");
}

Deno.test("workspace discovery finds projects matching config", async () => {
  const fs = setupRepo({
    "/repo/package.json": {
      workspaces: ["apps/*", "packages/*"],
    } satisfies PackageJson,
    "/repo/apps/web/package.json": {
      name: "@repo/webapp",
      private: true,
    } satisfies PackageJson,
    "/repo/apps/web/tsconfig.json": "{}",
    "/repo/packages/lib/package.json": {
      name: "@repo/lib",
    } satisfies PackageJson,
    "/repo/packages/lib/tsconfig.json": "{}",
  });
  const logger = createLogger();
  const globber = createStubGlob({
    [workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
    [workspaceGlobPattern("packages/*")]: ["/repo/packages/lib/package.json"],
  });
  const discovery = createWorkspaceDiscovery(globber);

  const inventory = await discovery.discover(
    baseConfig,
    baseOptions,
    logger,
    fs,
  );

  assertEquals(Object.keys(inventory.projects).length, 2);
  const webProject = inventory.projects["@repo/webapp"];
  const libProject = inventory.projects["@repo/lib"];
  assert(webProject !== undefined, "Expected @repo/webapp to be discovered");
  assert(libProject !== undefined, "Expected @repo/lib to be discovered");
  assertEquals(webProject.workspaceType, "app");
  assertEquals(libProject.workspaceType, "shared-package");
  assertEquals(inventory.warnings.length, 0);
});

Deno.test("workspace discovery warns about missing tsconfig and unmatched projects", async () => {
  const fs = setupRepo({
    "/repo/package.json": {
      workspaces: ["apps/*"],
    } satisfies PackageJson,
    "/repo/apps/app1/package.json": {
      name: "@repo/app1",
    } satisfies PackageJson,
    "/repo/apps/app1/tsconfig.json": "{}",
    "/repo/apps/no-config/package.json": {
      name: "@repo/no-config",
    } satisfies PackageJson,
  });
  const logger = createLogger();
  const globber = createStubGlob({
    [workspaceGlobPattern("apps/*")]: [
      "/repo/apps/app1/package.json",
      "/repo/apps/no-config/package.json",
    ],
  });
  const discovery = createWorkspaceDiscovery(globber);

  const customConfig: SyncConfig = {
    workspaceTypes: {
      "apps/app1": { type: "app", subType: "website" },
    },
  };

  const inventory = await discovery.discover(
    customConfig,
    baseOptions,
    logger,
    fs,
  );

  assertEquals(Object.keys(inventory.projects).length, 1);
  assert(
    inventory.warnings.some((w) => w.includes("missing tsconfig")),
    "expected warning for missing tsconfig",
  );
  assert(
    inventory.warnings.some((w) =>
      w.includes("does not match any configured workspace type")
    ),
    "expected warning for unmatched workspace",
  );
});

Deno.test("workspace discovery throws when root package.json missing", async () => {
  const fs = new InMemoryFileSystem();
  const logger = createLogger();
  const discovery = createWorkspaceDiscovery(createStubGlob({}));
  await assertRejects(
    () => discovery.discover(baseConfig, baseOptions, logger, fs),
    "No package.json found",
  );
});

async function assertRejects(
  fn: () => Promise<unknown>,
  messageIncludes?: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (messageIncludes && error instanceof Error) {
      assert(
        error.message.includes(messageIncludes),
        `Expected error message to include "${messageIncludes}", got "${error.message}"`,
      );
    }
    return;
  }
  throw new Error("Expected promise to reject but it resolved");
}
