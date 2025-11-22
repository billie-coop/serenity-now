import type {
  ChangeEmitterPort,
  ConfigLoaderPort,
  GraphResolverPort,
  ImportScannerPort,
  PhasePorts,
  WorkspaceDiscoveryPort,
} from "../../core/ports.ts";
import type {
  EmitResult,
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedGraph,
  SyncConfig,
} from "../../core/types.ts";

function createConfigLoader(): ConfigLoaderPort {
  return {
    load: (
      _options: RepoManagerOptions,
      logger,
      _fs,
    ): Promise<SyncConfig> => {
      logger.warn(
        "Config loader adapter not implemented yet. Returning empty config.",
      );
      return Promise.resolve({ workspaceTypes: {} });
    },
  };
}

function createWorkspaceDiscovery(): WorkspaceDiscoveryPort {
  return {
    discover: (
      _config: SyncConfig,
      _options: RepoManagerOptions,
      logger,
      _fs,
    ): Promise<ProjectInventory> => {
      logger.warn(
        "Workspace discovery adapter not implemented yet. Returning empty inventory.",
      );
      return Promise.resolve({
        projects: {},
        warnings: [],
        workspaceConfigs: {},
      });
    },
  };
}

function createImportScanner(): ImportScannerPort {
  return {
    scan: (
      _inventory: ProjectInventory,
      _config: SyncConfig,
      _options: RepoManagerOptions,
      logger,
    ): Promise<ProjectUsage> => {
      logger.warn(
        "Import scanner adapter not implemented yet. Returning empty usage.",
      );
      return Promise.resolve({ usage: {}, warnings: [] });
    },
  };
}

function createGraphResolver(): GraphResolverPort {
  return {
    resolve: (
      _inventory: ProjectInventory,
      _usage: ProjectUsage,
      _config: SyncConfig,
      _options: RepoManagerOptions,
      logger,
    ): Promise<ResolvedGraph> => {
      logger.warn(
        "Graph resolver adapter not implemented yet. Returning empty graph.",
      );
      return Promise.resolve({ projects: {}, cycles: [], warnings: [] });
    },
  };
}

function createChangeEmitter(): ChangeEmitterPort {
  return {
    emit: (
      _graph: ResolvedGraph,
      _inventory: ProjectInventory,
      _config: SyncConfig,
      _options: RepoManagerOptions,
      logger,
      _fs,
    ): Promise<EmitResult> => {
      logger.warn(
        "Change emitter adapter not implemented yet. Returning empty emit result.",
      );
      return Promise.resolve({
        filesModified: 0,
        projectsUpdated: [],
        staleDependencies: {},
        warnings: [],
      });
    },
  };
}

export function createStubPhasePorts(): PhasePorts {
  return {
    configLoader: createConfigLoader(),
    workspaceDiscovery: createWorkspaceDiscovery(),
    importScanner: createImportScanner(),
    graphResolver: createGraphResolver(),
    changeEmitter: createChangeEmitter(),
  };
}
