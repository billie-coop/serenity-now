import { runCli } from "./run.ts";
import type {
  EmitResult,
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedGraph,
  SyncConfig,
} from "../../core/types.ts";
import type {
  FileSystemPort,
  LoggerPort,
  PhasePorts,
  RepoManagerDeps,
} from "../../core/ports.ts";

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

interface FakePhaseOutputs {
  config?: SyncConfig;
  inventory?: ProjectInventory;
  usage?: ProjectUsage;
  graph?: ResolvedGraph;
  emit?: EmitResult;
}

function createFakeDeps(
  overrides: FakePhaseOutputs = {},
): {
  deps: {
    logger: LoggerPort;
    fileSystem: FileSystemPort;
    phases: PhasePorts;
  };
  warnings: string[];
} {
  const warnings: string[] = [];

  const logger = {
    phase: () => {},
    info: () => {},
    warn: (message: string) => {
      warnings.push(message);
    },
    error: () => {},
    debug: () => {},
    getWarnings: () => [...warnings],
  };

  const fileSystem = {
    readJson: <T>() => Promise.resolve({} as T),
    writeJson: () => Promise.resolve(),
    fileExists: () => Promise.resolve(true),
    readText: () => Promise.resolve(""),
    writeText: () => Promise.resolve(),
  };

  const config: SyncConfig = overrides.config ?? { workspaceTypes: {} };
  const inventory: ProjectInventory = overrides.inventory ?? {
    projects: {},
    warnings: ["inventory warning"],
    workspaceConfigs: {},
  };
  const usage: ProjectUsage = overrides.usage ?? {
    usage: {},
    warnings: ["usage warning"],
  };
  const graph: ResolvedGraph = overrides.graph ?? {
    projects: {},
    cycles: [],
    diamonds: [],
    warnings: ["graph warning"],
  };
  const emit: EmitResult = overrides.emit ?? {
    filesModified: 0,
    projectsUpdated: [],
    staleDependencies: {},
    warnings: ["emit warning"],
  };

  const phases = {
    configLoader: {
      load: (
        _opts: RepoManagerOptions,
        _logger: RepoManagerDeps["logger"],
        _fs: RepoManagerDeps["fileSystem"],
      ): Promise<SyncConfig> =>
        Promise.resolve({
          ...config,
          workspaceTypes: config.workspaceTypes ?? {},
        }),
    },
    workspaceDiscovery: {
      discover: (
        _config: SyncConfig,
        _options: RepoManagerOptions,
        _logger: RepoManagerDeps["logger"],
        _fs: RepoManagerDeps["fileSystem"],
      ): Promise<ProjectInventory> => Promise.resolve(inventory),
    },
    importScanner: {
      scan: (
        _inventory: ProjectInventory,
        _config: SyncConfig,
        _options: RepoManagerOptions,
        _logger: RepoManagerDeps["logger"],
        _fs: RepoManagerDeps["fileSystem"],
      ): Promise<ProjectUsage> => Promise.resolve(usage),
    },
    graphResolver: {
      resolve: (
        _inventory: ProjectInventory,
        _usage: ProjectUsage,
        _config: SyncConfig,
        _options: RepoManagerOptions,
        _logger: RepoManagerDeps["logger"],
      ): Promise<ResolvedGraph> => Promise.resolve(graph),
    },
    changeEmitter: {
      emit: (
        _graph: ResolvedGraph,
        _inventory: ProjectInventory,
        _config: SyncConfig,
        _options: RepoManagerOptions,
        _logger: RepoManagerDeps["logger"],
        _fs: RepoManagerDeps["fileSystem"],
      ): Promise<EmitResult> => Promise.resolve(emit),
    },
  };

  return {
    deps: {
      logger,
      fileSystem,
      phases,
    },
    warnings,
  };
}

function captureConsole() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs: string[] = [];
  const errors: string[] = [];

  console.log = ((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  }) as typeof console.log;

  console.warn = ((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  }) as typeof console.warn;

  console.error = ((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  }) as typeof console.error;

  return {
    logs,
    errors,
    restore() {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

Deno.test("runCli returns success with stub dependencies", async () => {
  const { deps } = createFakeDeps();
  const consoleCapture = captureConsole();
  try {
    const exitCode = await runCli([], () => deps);
    assertEquals(exitCode, 0);
    assert(
      consoleCapture.logs.some((line) => line.includes("Warnings")),
      "expected warnings to be printed",
    );
  } finally {
    consoleCapture.restore();
  }
});

Deno.test("runCli respects fail-on-stale option", async () => {
  const staleEmit: EmitResult = {
    filesModified: 0,
    projectsUpdated: [],
    warnings: [],
    staleDependencies: {
      "example": {
        packageJsonDeps: ["unused"],
        tsconfigPaths: [],
        tsconfigReferences: [],
      },
    },
  };

  const { deps } = createFakeDeps({ emit: staleEmit });
  const consoleCapture = captureConsole();
  try {
    const exitCode = await runCli(["--fail-on-stale"], () => deps);
    assertEquals(exitCode, 1);
    assert(
      consoleCapture.errors.some((line) =>
        line.includes("Stale dependencies detected")
      ),
      "expected stale dependency error message",
    );
  } finally {
    consoleCapture.restore();
  }
});

Deno.test("runCli exits with error code 2 when cycles detected without --force", async () => {
  const graphWithCycles: ResolvedGraph = {
    projects: {},
    cycles: [
      {
        path: ["@repo/a", "@repo/b", "@repo/a"],
        projects: [],
      },
    ],
    diamonds: [],
    warnings: [],
  };

  const { deps } = createFakeDeps({ graph: graphWithCycles });
  const consoleCapture = captureConsole();
  try {
    const exitCode = await runCli([], () => deps);
    assertEquals(exitCode, 2, "should exit with code 2 for cycles");
    assert(
      consoleCapture.errors.some((line) =>
        line.includes("circular dependency")
      ),
      "expected cycle error message",
    );
    assert(
      consoleCapture.errors.some((line) => line.includes("--force")),
      "expected suggestion to use --force",
    );
  } finally {
    consoleCapture.restore();
  }
});

Deno.test("runCli continues with warning when cycles detected with --force", async () => {
  const graphWithCycles: ResolvedGraph = {
    projects: {},
    cycles: [
      {
        path: ["@repo/a", "@repo/b", "@repo/a"],
        projects: [],
      },
    ],
    diamonds: [],
    warnings: [],
  };

  const { deps } = createFakeDeps({ graph: graphWithCycles });
  const consoleCapture = captureConsole();
  try {
    const exitCode = await runCli(["--force"], () => deps);
    assertEquals(exitCode, 0, "should exit with code 0 with --force");
    assert(
      consoleCapture.logs.some((line) =>
        line.includes("Warning") && line.includes("circular")
      ),
      "expected cycle warning",
    );
  } finally {
    consoleCapture.restore();
  }
});

Deno.test("runCli displays diamond dependencies in verbose mode", async () => {
  const graphWithDiamonds: ResolvedGraph = {
    projects: {},
    cycles: [],
    diamonds: [
      {
        projectId: "@repo/app",
        directDependency: "@repo/utils",
        transitiveThrough: ["@repo/lib"],
        pattern: "universal-utility",
        suggestion:
          "This is expected - @repo/utils is designed to be used everywhere.",
      },
    ],
    warnings: [],
  };

  const { deps } = createFakeDeps({ graph: graphWithDiamonds });
  const consoleCapture = captureConsole();
  try {
    const exitCode = await runCli(["--verbose"], () => deps);
    assertEquals(exitCode, 0);
    assert(
      consoleCapture.logs.some((line) => line.includes("Diamond Dependencies")),
      "expected diamond dependencies section",
    );
    assert(
      consoleCapture.logs.some((line) => line.includes("@repo/app")),
      "expected project name in diamond output",
    );
    assert(
      consoleCapture.logs.some((line) => line.includes("@repo/utils")),
      "expected dependency name in diamond output",
    );
  } finally {
    consoleCapture.restore();
  }
});

Deno.test("runCli displays analytics in verbose mode", async () => {
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
      },
      "@repo/lib": {
        id: "@repo/lib",
        root: "/repo/packages/lib",
        relativeRoot: "packages/lib",
        packageJson: { name: "@repo/lib" },
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
      "@repo/app": {
        dependencies: ["@repo/lib"],
        typeOnlyDependencies: [],
        usageDetails: [],
      },
    },
    warnings: [],
  };

  const { deps } = createFakeDeps({ inventory, usage });
  const consoleCapture = captureConsole();
  try {
    const exitCode = await runCli(["--verbose"], () => deps);
    assertEquals(exitCode, 0);
    assert(
      consoleCapture.logs.some((line) => line.includes("Import Analysis")),
      "expected import analysis section",
    );
    assert(
      consoleCapture.logs.some((line) =>
        line.includes("Dependency Graph Analysis")
      ),
      "expected graph analysis section",
    );
  } finally {
    consoleCapture.restore();
  }
});

Deno.test("runCli displays help message with --help flag", async () => {
  const { deps } = createFakeDeps();
  const consoleCapture = captureConsole();
  try {
    const exitCode = await runCli(["--help"], () => deps);
    assertEquals(exitCode, 0);
    assert(
      consoleCapture.logs.some((line) => line.includes("serenity-now")),
      "expected help message",
    );
    assert(
      consoleCapture.logs.some((line) => line.includes("--dry-run")),
      "expected --dry-run option in help",
    );
    assert(
      consoleCapture.logs.some((line) => line.includes("--verbose")),
      "expected --verbose option in help",
    );
  } finally {
    consoleCapture.restore();
  }
});

Deno.test("runCli displays health report with --health flag", async () => {
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
      },
    },
    warnings: [
      "Project @repo/app at apps/app is missing tsconfig.json",
    ],
    workspaceConfigs: {},
  };

  const graphWithDiamonds: ResolvedGraph = {
    projects: {},
    cycles: [],
    diamonds: [
      {
        projectId: "@repo/app",
        directDependency: "@repo/lib",
        transitiveThrough: ["@repo/ui"],
        pattern: "incomplete-abstraction",
        suggestion: "Consider refactoring",
      },
    ],
    warnings: [],
  };

  const config: SyncConfig = {
    workspaceTypes: {},
    defaultDependencies: [],
  };

  const { deps } = createFakeDeps({
    config,
    inventory,
    graph: graphWithDiamonds,
  });
  const consoleCapture = captureConsole();
  try {
    const exitCode = await runCli(["--health"], () => deps);
    assertEquals(exitCode, 0);
    assert(
      consoleCapture.logs.some((line) => line.includes("Health Check")),
      "expected health check header",
    );
    assert(
      consoleCapture.logs.some((line) => line.includes("Diamond Dependencies")),
      "expected diamond dependencies section",
    );
    assert(
      consoleCapture.logs.some((line) => line.includes("Missing tsconfig")),
      "expected missing tsconfig section",
    );
  } finally {
    consoleCapture.restore();
  }
});
