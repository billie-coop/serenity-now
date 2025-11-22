import { runCli } from "./run.ts";
import type { RepoManagerDeps } from "../../core/ports.ts";
import type {
  EmitResult,
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedGraph,
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

interface FakePhaseOutputs {
  config?: SyncConfig;
  inventory?: ProjectInventory;
  usage?: ProjectUsage;
  graph?: ResolvedGraph;
  emit?: EmitResult;
}

function createFakeDeps(
  overrides: FakePhaseOutputs = {},
): { deps: RepoManagerDeps; warnings: string[] } {
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
