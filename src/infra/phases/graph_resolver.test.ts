import { createGraphResolver } from "./graph_resolver.ts";
import type { LoggerPort } from "../../core/ports.ts";
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
  );

  const appNode = graph.projects["app"];
  assert(appNode !== undefined, "Expected resolved project for app");
  const sharedDep = appNode.dependencies["shared"];
  assert(sharedDep !== undefined, "Expected dependency on shared");
  assertEquals(sharedDep.sourceFiles, ["src/main.ts"]);
});

Deno.test("graph resolver warns about missing dependencies", async () => {
  const usage: ProjectUsage = {
    usage: {
      "app": {
        dependencies: ["missing"],
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
  );
  assert(
    graph.warnings.some((w) => w.includes("missing")),
    "Expected warning for missing dependency",
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
  );

  assert(graph.cycles.length > 0, "Expected cycle to be detected");
});
