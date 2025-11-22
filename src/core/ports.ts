import type {
  EmitResult,
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedGraph,
  SyncConfig,
} from "./types.ts";

export interface LoggerPort {
  phase(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface FileSystemPort {
  readJson<T>(path: string): Promise<T>;
  writeJson(path: string, value: unknown): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
}

export interface ConfigLoaderPort {
  load(
    options: RepoManagerOptions,
    logger: LoggerPort,
    fs: FileSystemPort,
  ): Promise<SyncConfig>;
}

export interface WorkspaceDiscoveryPort {
  discover(
    config: SyncConfig,
    options: RepoManagerOptions,
    logger: LoggerPort,
    fs: FileSystemPort,
  ): Promise<ProjectInventory>;
}

export interface ImportScannerPort {
  scan(
    inventory: ProjectInventory,
    config: SyncConfig,
    options: RepoManagerOptions,
    logger: LoggerPort,
  ): Promise<ProjectUsage>;
}

export interface GraphResolverPort {
  resolve(
    inventory: ProjectInventory,
    usage: ProjectUsage,
    config: SyncConfig,
    options: RepoManagerOptions,
    logger: LoggerPort,
  ): Promise<ResolvedGraph>;
}

export interface ChangeEmitterPort {
  emit(
    graph: ResolvedGraph,
    inventory: ProjectInventory,
    config: SyncConfig,
    options: RepoManagerOptions,
    logger: LoggerPort,
    fs: FileSystemPort,
  ): Promise<EmitResult>;
}

export interface PhasePorts {
  configLoader: ConfigLoaderPort;
  workspaceDiscovery: WorkspaceDiscoveryPort;
  importScanner: ImportScannerPort;
  graphResolver: GraphResolverPort;
  changeEmitter: ChangeEmitterPort;
}

export interface RepoManagerDeps {
  logger: LoggerPort;
  fileSystem: FileSystemPort;
  phases: PhasePorts;
}
