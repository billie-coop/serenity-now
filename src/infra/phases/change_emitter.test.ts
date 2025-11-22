import { createChangeEmitter } from "./change_emitter.ts";
import type { FileSystemPort, LoggerPort } from "../../core/ports.ts";
import type {
  ProjectInventory,
  RepoManagerOptions,
  ResolvedGraph,
  ResolvedProject,
  SyncConfig,
} from "../../core/types.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`Expected ${b} but received ${a}`);
  }
}

class InMemoryFileSystem implements FileSystemPort {
  #files = new Map<string, string>();

  constructor(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      this.#files.set(path, content);
    }
  }

  readJson<T>(path: string): Promise<T> {
    const text = this.#files.get(path);
    if (text === undefined) {
      return Promise.reject(new Error(`Missing file: ${path}`));
    }
    return Promise.resolve(JSON.parse(text) as T);
  }

  writeJson(path: string, value: unknown): Promise<void> {
    this.#files.set(path, `${JSON.stringify(value, null, 2)}\n`);
    return Promise.resolve();
  }

  fileExists(path: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(path));
  }

  readText(path: string): Promise<string> {
    const text = this.#files.get(path);
    if (text === undefined) {
      return Promise.reject(new Error(`Missing file: ${path}`));
    }
    return Promise.resolve(text);
  }

  writeText(path: string, contents: string): Promise<void> {
    this.#files.set(path, contents);
    return Promise.resolve();
  }
}

class MemoryLogger implements LoggerPort {
  infos: string[] = [];
  warns: string[] = [];
  phase(): void {}
  info(message: string): void {
    this.infos.push(message);
  }
  warn(message: string): void {
    this.warns.push(message);
  }
  error(): void {}
  debug(): void {}
}

function createGraph(): ResolvedGraph {
  function getProject(id: string) {
    const project = baseInventory.projects[id];
    assert(project !== undefined, `Missing project ${id}`);
    return project;
  }

  const projectApp: ResolvedProject = {
    project: getProject("@repo/app"),
    dependencies: {
      "@repo/lib": {
        dependency: getProject("@repo/lib"),
        entryPoint: {
          path: "src/index.ts",
          exists: true,
          isTypeDefinition: false,
        },
        reason: "import",
        sourceFiles: ["src/main.ts"],
      },
    },
  };

  const projectLib: ResolvedProject = {
    project: getProject("@repo/lib"),
    dependencies: {},
  };

  return {
    projects: {
      "@repo/app": projectApp,
      "@repo/lib": projectLib,
    },
    cycles: [],
    diamonds: [],
    warnings: [],
  };
}

const baseInventory: ProjectInventory = {
  projects: {
    "@repo/app": {
      id: "@repo/app",
      root: "/repo/apps/app",
      relativeRoot: "apps/app",
      packageJson: { name: "@repo/app" },
      workspaceType: "app",
      workspaceSubType: "website",
      isPrivate: true,
      tsconfigPath: "/repo/apps/app/tsconfig.json",
    },
    "@repo/lib": {
      id: "@repo/lib",
      root: "/repo/packages/lib",
      relativeRoot: "packages/lib",
      packageJson: { name: "@repo/lib" },
      workspaceType: "shared-package",
      workspaceSubType: "library",
      isPrivate: false,
      tsconfigPath: "/repo/packages/lib/tsconfig.json",
    },
  },
  warnings: [],
  workspaceConfigs: {},
};

const baseConfig: SyncConfig = {};

Deno.test("change emitter updates package and tsconfig files", async () => {
  const files = new InMemoryFileSystem({
    "/repo/apps/app/package.json": JSON.stringify({
      name: "@repo/app",
      dependencies: { lodash: "^4.0.0" },
    }),
    "/repo/apps/app/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: {} },
      references: [],
    }),
    "/repo/packages/lib/package.json": JSON.stringify({
      name: "@repo/lib",
      dependencies: {},
    }),
    "/repo/packages/lib/tsconfig.json": JSON.stringify({
      compilerOptions: {},
      references: [],
    }),
  });
  const logger = new MemoryLogger();
  const emitter = createChangeEmitter();
  const graph = createGraph();

  const result = await emitter.emit(
    graph,
    baseInventory,
    baseConfig,
    { rootDir: "/repo", dryRun: true } as RepoManagerOptions,
    logger,
    files,
  );

  const pkgDiff = result.diffs?.["/repo/apps/app/package.json"];
  assert(pkgDiff !== undefined, "Expected package.json diff");
  assert(
    Object.keys(result.staleDependencies).length === 0,
    "Did not expect stale dependencies",
  );
  assertEquals(result.projectsUpdated.sort(), ["@repo/app"]);
});

Deno.test("change emitter records stale dependencies", async () => {
  const files = new InMemoryFileSystem({
    "/repo/apps/app/package.json": JSON.stringify({
      name: "@repo/app",
      dependencies: {
        "@repo/unused": "workspace:*",
      },
    }),
    "/repo/apps/app/tsconfig.json": JSON.stringify({
      compilerOptions: {
        paths: { "@repo/unused": ["../unused/src/index.ts"] },
      },
      references: [{ path: "../unused" }],
    }),
    "/repo/packages/lib/package.json": JSON.stringify({
      name: "@repo/lib",
      dependencies: {},
    }),
    "/repo/packages/lib/tsconfig.json": JSON.stringify({
      compilerOptions: {},
      references: [],
    }),
  });
  const logger = new MemoryLogger();
  const emitter = createChangeEmitter();
  const graph = createGraph();

  const result = await emitter.emit(
    graph,
    baseInventory,
    baseConfig,
    { rootDir: "/repo", dryRun: true } as RepoManagerOptions,
    logger,
    files,
  );

  assert("@repo/app" in result.staleDependencies, "Expected stale record");
  const stale = result.staleDependencies["@repo/app"];
  assertEquals(stale?.packageJsonDeps, ["@repo/unused"]);
  assertEquals(stale?.tsconfigPaths, ["@repo/unused"]);
  assertEquals(stale?.tsconfigReferences, ["../unused"]);
});
