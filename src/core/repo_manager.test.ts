import { RepoManager } from "./repo_manager.ts";
import type { PhasePorts, RepoManagerDeps } from "./ports.ts";
import type {
  EmitResult,
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedGraph,
  SyncConfig,
} from "./types.ts";

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

async function assertRejects(
  fn: () => Promise<unknown>,
  errorCtor?: ErrorConstructor,
  messageIncludes?: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (errorCtor && !(error instanceof errorCtor)) {
      throw new Error(
        `Expected error to be instance of ${errorCtor.name}, received ${
          error?.constructor?.name ?? "unknown"
        }`,
      );
    }
    if (messageIncludes && error instanceof Error) {
      assert(
        error.message.includes(messageIncludes),
        `Expected error message to include "${messageIncludes}" but got "${error.message}"`,
      );
    }
    return;
  }
  throw new Error("Expected function to reject, but it resolved");
}

function makeTestDeps(log: string[]): RepoManagerDeps {
  const logger = {
    phase: (msg: string) => log.push(`phase:${msg}`),
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    getWarnings: () => [],
  };

  const fileSystem = {
    readJson: <T>(_: string): Promise<T> => Promise.resolve({} as T),
    writeJson: () => Promise.resolve(),
    fileExists: () => Promise.resolve(true),
    readText: () => Promise.resolve(""),
    writeText: () => Promise.resolve(),
  };

  const phases: PhasePorts = {
    configLoader: {
      load: (
        options: RepoManagerOptions,
        _logger,
      ): Promise<SyncConfig> => {
        log.push(`config-loader:${options.rootDir}`);
        return Promise.resolve({ workspaceTypes: {} });
      },
    },
    workspaceDiscovery: {
      discover: (
        _config: SyncConfig,
      ): Promise<ProjectInventory> => {
        log.push("workspace-discovery");
        return Promise.resolve({
          projects: {},
          warnings: [],
          workspaceConfigs: {},
        });
      },
    },
    importScanner: {
      scan: (
        _inventory: ProjectInventory,
        _config: SyncConfig,
        _options: RepoManagerOptions,
        _logger,
        _fs,
      ): Promise<ProjectUsage> => {
        log.push("import-scan");
        return Promise.resolve({ usage: {}, warnings: [] });
      },
    },
    graphResolver: {
      resolve: (): Promise<ResolvedGraph> => {
        log.push("graph-resolve");
        return Promise.resolve({ projects: {}, cycles: [], warnings: [] });
      },
    },
    changeEmitter: {
      emit: (): Promise<EmitResult> => {
        log.push("change-emit");
        return Promise.resolve({
          filesModified: 0,
          projectsUpdated: [],
          staleDependencies: {},
          warnings: [],
        });
      },
    },
  };

  return { logger, fileSystem, phases };
}

Deno.test("RepoManager orchestrates phases in order", async () => {
  const log: string[] = [];
  const deps = makeTestDeps(log);
  const manager = new RepoManager({ rootDir: "/tmp" }, deps);

  await manager.loadConfig();
  const inventory = await manager.discoverWorkspace();
  const usage = await manager.scanImports(inventory);
  const graph = await manager.resolveGraph(inventory, usage);
  const emitResult = await manager.emitChanges(graph, inventory);

  assertEquals(emitResult.filesModified, 0);
  assertEquals(log, [
    "phase:Loading Configuration",
    "config-loader:/tmp",
    "phase:Discovering Workspace",
    "workspace-discovery",
    "phase:Scanning Imports",
    "import-scan",
    "phase:Resolving Dependency Graph",
    "graph-resolve",
    "phase:Emitting Changes",
    "change-emit",
  ]);
});

Deno.test("RepoManager enforces configuration before other phases", async () => {
  const deps = makeTestDeps([]);
  const manager = new RepoManager({ rootDir: "/tmp" }, deps);
  await assertRejects(
    () => manager.discoverWorkspace(),
    Error,
    "Configuration must be loaded",
  );
});
