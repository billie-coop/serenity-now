import { createChangeEmitter } from "./change_emitter.ts";
import type { FileSystemPort, LoggerPort } from "../../core/ports.ts";
import type {
  PackageJson,
  ProjectInventory,
  RepoManagerOptions,
  ResolvedGraph,
  ResolvedProject,
  SyncConfig,
  TsConfig,
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
  debug(_message?: string): void {}
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

Deno.test("change emitter substitutes template vars in packageJsonTemplate", async () => {
  const inventory: ProjectInventory = {
    projects: {
      "@repo/app": {
        id: "@repo/app",
        root: "/repo/apps/my-app",
        relativeRoot: "apps/my-app",
        packageJson: { name: "@repo/app" },
        workspaceType: "app",
        workspaceSubType: "website",
        isPrivate: true,
        tsconfigPath: "/repo/apps/my-app/tsconfig.json",
        workspaceConfig: {
          type: "app",
          packageJsonTemplate: {
            version: "1.0.0-{{projectDir}}",
          },
        },
      },
    },
    warnings: [],
    workspaceConfigs: {},
  };

  const projectApp = {
    project: inventory.projects["@repo/app"]!,
    dependencies: {},
  };

  const graph: ResolvedGraph = {
    projects: {
      "@repo/app": projectApp,
    },
    cycles: [],
    diamonds: [],
    warnings: [],
  };

  const files = new InMemoryFileSystem({
    "/repo/apps/my-app/package.json": JSON.stringify({
      name: "@repo/app",
    }),
    "/repo/apps/my-app/tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
  });
  const logger = new MemoryLogger();
  const emitter = createChangeEmitter();

  await emitter.emit(
    graph,
    inventory,
    baseConfig,
    { rootDir: "/repo", dryRun: false } as RepoManagerOptions,
    logger,
    files,
  );

  const updatedPkg = await files.readJson<{ version?: string }>(
    "/repo/apps/my-app/package.json",
  );
  assertEquals(updatedPkg.version, "1.0.0-my-app");
});

Deno.test("change emitter handles array templates", async () => {
  const inventory: ProjectInventory = {
    projects: {
      "@repo/app": {
        id: "@repo/app",
        root: "/repo/apps/test-app",
        relativeRoot: "apps/test-app",
        packageJson: { name: "@repo/app" },
        workspaceType: "app",
        workspaceSubType: "website",
        isPrivate: true,
        tsconfigPath: "/repo/apps/test-app/tsconfig.json",
        workspaceConfig: {
          type: "app",
          tsconfigTemplate: {
            include: ["src/**/*", "{{projectDir}}/**/*"],
          },
        },
      },
    },
    warnings: [],
    workspaceConfigs: {},
  };

  const graph: ResolvedGraph = {
    projects: {
      "@repo/app": {
        project: inventory.projects["@repo/app"]!,
        dependencies: {},
      },
    },
    cycles: [],
    diamonds: [],
    warnings: [],
  };

  const files = new InMemoryFileSystem({
    "/repo/apps/test-app/package.json": JSON.stringify({
      name: "@repo/app",
    }),
    "/repo/apps/test-app/tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
  });
  const logger = new MemoryLogger();
  const emitter = createChangeEmitter();

  await emitter.emit(
    graph,
    inventory,
    baseConfig,
    { rootDir: "/repo", dryRun: false } as RepoManagerOptions,
    logger,
    files,
  );

  const updatedTsconfig = await files.readJson<{ include?: string[] }>(
    "/repo/apps/test-app/tsconfig.json",
  );
  assertEquals(updatedTsconfig.include, ["src/**/*", "test-app/**/*"]);
});

Deno.test("change emitter deep merges nested objects in templates", async () => {
  const inventory: ProjectInventory = {
    projects: {
      "@repo/app": {
        id: "@repo/app",
        root: "/repo/apps/app",
        relativeRoot: "apps/app",
        packageJson: {
          name: "@repo/app",
          dependencies: {
            "old-dep": "^1.0.0",
          },
        },
        workspaceType: "app",
        workspaceSubType: "website",
        isPrivate: true,
        tsconfigPath: "/repo/apps/app/tsconfig.json",
        workspaceConfig: {
          type: "app",
          packageJsonTemplate: {
            dependencies: {
              "new-dep": "^2.0.0",
            },
          },
        },
      },
    },
    warnings: [],
    workspaceConfigs: {},
  };

  const graph: ResolvedGraph = {
    projects: {
      "@repo/app": {
        project: inventory.projects["@repo/app"]!,
        dependencies: {},
      },
    },
    cycles: [],
    diamonds: [],
    warnings: [],
  };

  const files = new InMemoryFileSystem({
    "/repo/apps/app/package.json": JSON.stringify({
      name: "@repo/app",
      dependencies: {
        "old-dep": "^1.0.0",
      },
    }),
    "/repo/apps/app/tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
  });
  const logger = new MemoryLogger();
  const emitter = createChangeEmitter();

  await emitter.emit(
    graph,
    inventory,
    baseConfig,
    { rootDir: "/repo", dryRun: false } as RepoManagerOptions,
    logger,
    files,
  );

  const updatedPkg = await files.readJson<PackageJson>(
    "/repo/apps/app/package.json",
  );
  // old-dep preserved, new-dep added via deep merge
  assertEquals(updatedPkg.dependencies?.["old-dep"], "^1.0.0");
  assertEquals(updatedPkg.dependencies?.["new-dep"], "^2.0.0");
});

Deno.test("change emitter handles entry points without src/ prefix", async () => {
  const inventory: ProjectInventory = {
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

  const graph: ResolvedGraph = {
    projects: {
      "@repo/app": {
        project: inventory.projects["@repo/app"]!,
        dependencies: {
          "@repo/lib": {
            dependency: inventory.projects["@repo/lib"]!,
            entryPoint: {
              path: "index.ts", // No src/ prefix
              exists: true,
              isTypeDefinition: false,
            },
            reason: "import",
            sourceFiles: ["src/main.ts"],
          },
        },
      },
      "@repo/lib": {
        project: inventory.projects["@repo/lib"]!,
        dependencies: {},
      },
    },
    cycles: [],
    diamonds: [],
    warnings: [],
  };

  const files = new InMemoryFileSystem({
    "/repo/apps/app/package.json": JSON.stringify({ name: "@repo/app" }),
    "/repo/apps/app/tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
    "/repo/packages/lib/package.json": JSON.stringify({ name: "@repo/lib" }),
    "/repo/packages/lib/tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
  });
  const logger = new MemoryLogger();
  const emitter = createChangeEmitter();

  await emitter.emit(
    graph,
    inventory,
    baseConfig,
    { rootDir: "/repo", dryRun: false } as RepoManagerOptions,
    logger,
    files,
  );

  const updatedTsconfig = await files.readJson<TsConfig>(
    "/repo/apps/app/tsconfig.json",
  );
  // Should create wildcard path without src/ prefix
  // Path is relative from tsconfig location (apps/app) to package location (packages/lib)
  assertEquals(updatedTsconfig.compilerOptions?.paths?.["@repo/lib/*"], [
    "../../packages/lib/*",
  ]);
});

Deno.test("change emitter handles projects without tsconfig", async () => {
  const inventory: ProjectInventory = {
    projects: {
      "@repo/app": {
        id: "@repo/app",
        root: "/repo/apps/app",
        relativeRoot: "apps/app",
        packageJson: { name: "@repo/app" },
        workspaceType: "app",
        workspaceSubType: "website",
        isPrivate: true,
        // No tsconfigPath
      },
    },
    warnings: [],
    workspaceConfigs: {},
  };

  const graph: ResolvedGraph = {
    projects: {
      "@repo/app": {
        project: inventory.projects["@repo/app"]!,
        dependencies: {},
      },
    },
    cycles: [],
    diamonds: [],
    warnings: [],
  };

  const files = new InMemoryFileSystem({
    "/repo/apps/app/package.json": JSON.stringify({ name: "@repo/app" }),
  });
  const logger = new MemoryLogger();
  const emitter = createChangeEmitter();

  const result = await emitter.emit(
    graph,
    inventory,
    baseConfig,
    { rootDir: "/repo", dryRun: false } as RepoManagerOptions,
    logger,
    files,
  );

  // Should only update package.json, not tsconfig
  assertEquals(result.filesModified, 0); // No changes needed
});

Deno.test("change emitter warns when package.json read fails", async () => {
  const files = new InMemoryFileSystem({
    // Missing package.json for @repo/app
    "/repo/packages/lib/package.json": JSON.stringify({ name: "@repo/lib" }),
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

  assert(
    result.warnings.some((w) => w.includes("Failed to read package.json")),
    "Expected warning about failed package.json read",
  );
});

Deno.test("change emitter writes files in non-dry-run mode", async () => {
  const files = new InMemoryFileSystem({
    "/repo/apps/app/package.json": JSON.stringify({
      name: "@repo/app",
      dependencies: {},
    }),
    "/repo/apps/app/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: {} },
      references: [],
    }),
    "/repo/packages/lib/package.json": JSON.stringify({
      name: "@repo/lib",
    }),
    "/repo/packages/lib/tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
  });
  const logger = new MemoryLogger();
  const emitter = createChangeEmitter();
  const graph = createGraph();

  const result = await emitter.emit(
    graph,
    baseInventory,
    baseConfig,
    { rootDir: "/repo", dryRun: false } as RepoManagerOptions,
    logger,
    files,
  );

  // Should write files, not create diffs
  assertEquals(result.diffs, undefined);
  // Modifies: app's package.json, app's tsconfig.json, lib's tsconfig.json
  assertEquals(result.filesModified, 3);

  // Verify files were actually written
  const updatedPkg = await files.readJson<PackageJson>(
    "/repo/apps/app/package.json",
  );
  assertEquals(updatedPkg.dependencies?.["@repo/lib"], "workspace:*");
});

Deno.test("change emitter logs debug messages in verbose mode", async () => {
  const files = new InMemoryFileSystem({
    "/repo/apps/app/package.json": JSON.stringify({
      name: "@repo/app",
      dependencies: {},
    }),
    "/repo/apps/app/tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
    "/repo/packages/lib/package.json": JSON.stringify({
      name: "@repo/lib",
    }),
    "/repo/packages/lib/tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
  });

  class VerboseLogger extends MemoryLogger {
    debugs: string[] = [];
    override debug(message: string): void {
      this.debugs.push(message);
    }
  }

  const logger = new VerboseLogger();
  const emitter = createChangeEmitter();
  const graph = createGraph();

  await emitter.emit(
    graph,
    baseInventory,
    baseConfig,
    { rootDir: "/repo", dryRun: false, verbose: true } as RepoManagerOptions,
    logger,
    files,
  );

  assert(
    logger.debugs.some((d) => d.includes("Updated package.json")),
    "Expected debug message about package.json update",
  );
  assert(
    logger.debugs.some((d) => d.includes("Updated tsconfig.json")),
    "Expected debug message about tsconfig.json update",
  );
});
