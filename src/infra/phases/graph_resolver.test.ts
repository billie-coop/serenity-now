import { createGraphResolver } from "./graph_resolver.ts";
import type { FileSystemPort, LoggerPort } from "../../core/ports.ts";
import type {
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
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

function createLogger(): LoggerPort {
  return {
    phase: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

function createMockFs(): FileSystemPort {
  return {
    fileExists: () => Promise.resolve(true),
    readJson: <T>() => Promise.resolve({} as T),
    writeJson: () => Promise.resolve(),
    readText: () => Promise.resolve(""),
    writeText: () => Promise.resolve(),
  };
}

const baseInventory: ProjectInventory = {
  projects: {
    "app": {
      id: "app",
      root: "/repo/apps/app",
      relativeRoot: "apps/app",
      packageJson: { name: "app" },
      workspaceType: "app",
      workspaceSubType: "website",
      isPrivate: true,
    },
    "shared": {
      id: "shared",
      root: "/repo/packages/shared",
      relativeRoot: "packages/shared",
      packageJson: { name: "shared" },
      workspaceType: "shared-package",
      workspaceSubType: "library",
      isPrivate: false,
    },
  },
  warnings: [],
  workspaceConfigs: {},
};

const baseUsage: ProjectUsage = {
  usage: {
    "app": {
      dependencies: ["shared"],
      typeOnlyDependencies: [],
      usageDetails: [{
        dependencyId: "shared",
        specifier: "shared",
        isTypeOnly: false,
        sourceFile: "src/main.ts",
      }],
    },
  },
  warnings: [],
};

const baseConfig: SyncConfig = {};
const baseOptions: RepoManagerOptions = { rootDir: "/repo" };

Deno.test("graph resolver links dependencies between projects", async () => {
  const resolver = createGraphResolver();

  const graph = await resolver.resolve(
    baseInventory,
    baseUsage,
    baseConfig,
    baseOptions,
    createLogger(),
    createMockFs(),
  );

  const appNode = graph.projects["app"];
  assert(appNode !== undefined, "Expected resolved project for app");
  const sharedDep = appNode.dependencies["shared"];
  assert(sharedDep !== undefined, "Expected dependency on shared");
  assertEquals(sharedDep.sourceFiles, ["src/main.ts"]);
});

Deno.test("graph resolver skips external dependencies silently", async () => {
  const usage: ProjectUsage = {
    usage: {
      "app": {
        dependencies: ["react", "lodash", "@types/node"],
        typeOnlyDependencies: [],
        usageDetails: [],
      },
    },
    warnings: [],
  };
  const resolver = createGraphResolver();
  const graph = await resolver.resolve(
    baseInventory,
    usage,
    baseConfig,
    baseOptions,
    createLogger(),
    createMockFs(),
  );

  // External dependencies should be skipped silently (no warnings)
  assertEquals(graph.warnings.length, 0);

  // The resolved project should have no dependencies (external packages filtered out)
  assertEquals(
    Object.keys(graph.projects["app"]?.dependencies ?? {}).length,
    0,
  );
});

Deno.test("graph resolver detects cycles", async () => {
  const inventory: ProjectInventory = {
    projects: {
      a: {
        id: "a",
        root: "/repo/a",
        relativeRoot: "a",
        packageJson: { name: "a" },
        workspaceType: "app",
        workspaceSubType: "website",
        isPrivate: true,
      },
      b: {
        id: "b",
        root: "/repo/b",
        relativeRoot: "b",
        packageJson: { name: "b" },
        workspaceType: "app",
        workspaceSubType: "website",
        isPrivate: true,
      },
    },
    warnings: [],
    workspaceConfigs: {},
  };
  const usage: ProjectUsage = {
    usage: {
      a: {
        dependencies: ["b"],
        typeOnlyDependencies: [],
        usageDetails: [],
      },
      b: {
        dependencies: ["a"],
        typeOnlyDependencies: [],
        usageDetails: [],
      },
    },
    warnings: [],
  };

  const resolver = createGraphResolver();
  const graph = await resolver.resolve(
    inventory,
    usage,
    baseConfig,
    baseOptions,
    createLogger(),
    createMockFs(),
  );

  assert(graph.cycles.length > 0, "Expected cycle to be detected");
});

Deno.test("graph resolver filters external scoped packages", async () => {
  const usage: ProjectUsage = {
    usage: {
      "app": {
        dependencies: ["@react/core", "@types/node", "@testing-library/react"],
        typeOnlyDependencies: [],
        usageDetails: [],
      },
    },
    warnings: [],
  };
  const resolver = createGraphResolver();
  const graph = await resolver.resolve(
    baseInventory,
    usage,
    baseConfig,
    baseOptions,
    createLogger(),
    createMockFs(),
  );

  // External scoped packages should be filtered
  assertEquals(graph.warnings.length, 0);
  assertEquals(
    Object.keys(graph.projects["app"]?.dependencies ?? {}).length,
    0,
  );
});

Deno.test("graph resolver filters external unscoped packages", async () => {
  const usage: ProjectUsage = {
    usage: {
      "app": {
        dependencies: ["react", "lodash", "vite"],
        typeOnlyDependencies: [],
        usageDetails: [],
      },
    },
    warnings: [],
  };
  const resolver = createGraphResolver();
  const graph = await resolver.resolve(
    baseInventory,
    usage,
    baseConfig,
    baseOptions,
    createLogger(),
    createMockFs(),
  );

  // External unscoped packages should be filtered
  assertEquals(graph.warnings.length, 0);
  assertEquals(
    Object.keys(graph.projects["app"]?.dependencies ?? {}).length,
    0,
  );
});

Deno.test("graph resolver handles deep imports to workspace packages", async () => {
  const inventory: ProjectInventory = {
    projects: {
      "app": {
        id: "app",
        root: "/repo/app",
        relativeRoot: "app",
        packageJson: { name: "app" },
        workspaceType: "app",
        workspaceSubType: "website",
        isPrivate: true,
      },
      "@repo/utils": {
        id: "@repo/utils",
        root: "/repo/packages/utils",
        relativeRoot: "packages/utils",
        packageJson: { name: "@repo/utils" },
        workspaceType: "shared-package",
        workspaceSubType: "library",
        isPrivate: false,
      },
    },
    warnings: [],
    workspaceConfigs: {},
  };

  const usage: ProjectUsage = {
    usage: {
      "app": {
        // Deep imports to workspace package
        dependencies: ["@repo/utils/src/helpers", "@repo/utils/src/validators"],
        typeOnlyDependencies: [],
        usageDetails: [
          {
            sourceFile: "src/main.ts",
            dependencyId: "@repo/utils/src/helpers",
            specifier: "@repo/utils/src/helpers",
            isTypeOnly: false,
          },
          {
            sourceFile: "src/main.ts",
            dependencyId: "@repo/utils/src/validators",
            specifier: "@repo/utils/src/validators",
            isTypeOnly: false,
          },
        ],
      },
    },
    warnings: [],
  };

  const resolver = createGraphResolver();
  const graph = await resolver.resolve(
    inventory,
    usage,
    baseConfig,
    baseOptions,
    createLogger(),
    createMockFs(),
  );

  // Deep imports should be consolidated to the package root
  const deps = graph.projects["app"]?.dependencies;
  assertEquals(Object.keys(deps ?? {}).length, 1);
  assert(
    deps?.["@repo/utils"] !== undefined,
    "Expected @repo/utils dependency",
  );

  // Source files from both deep imports should be merged (but they're from the same file)
  // Since both imports are from "src/main.ts", we should only have 1 unique source file
  const utilsDep = deps?.["@repo/utils"];
  assertEquals(utilsDep?.sourceFiles.length, 1);
  assertEquals(utilsDep?.sourceFiles[0], "src/main.ts");
});

Deno.test("graph resolver handles self-imports via deep paths", async () => {
  const inventory: ProjectInventory = {
    projects: {
      "@repo/utils": {
        id: "@repo/utils",
        root: "/repo/packages/utils",
        relativeRoot: "packages/utils",
        packageJson: { name: "@repo/utils" },
        workspaceType: "shared-package",
        workspaceSubType: "library",
        isPrivate: false,
      },
    },
    warnings: [],
    workspaceConfigs: {},
  };

  const usage: ProjectUsage = {
    usage: {
      "@repo/utils": {
        // Package importing from itself via deep path
        dependencies: ["@repo/utils/src/internal"],
        typeOnlyDependencies: [],
        usageDetails: [
          {
            sourceFile: "src/index.ts",
            dependencyId: "@repo/utils/src/internal",
            specifier: "@repo/utils/src/internal",
            isTypeOnly: false,
          },
        ],
      },
    },
    warnings: [],
  };

  const resolver = createGraphResolver();
  const graph = await resolver.resolve(
    inventory,
    usage,
    baseConfig,
    baseOptions,
    createLogger(),
    createMockFs(),
  );

  // Self-imports should be filtered out (no self-dependency)
  const deps = graph.projects["@repo/utils"]?.dependencies;
  assertEquals(Object.keys(deps ?? {}).length, 0);

  // No cycles should be detected
  assertEquals(graph.cycles.length, 0);
});
