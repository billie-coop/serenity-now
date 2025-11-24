import type {
  EmitResult,
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedGraph,
  SyncConfig,
} from "./types.js";
import type { RepoManagerDeps } from "./ports.js";

/**
 * RepoManager orchestrates the main sync phases while depending only on ports.
 */
export class RepoManager {
  private config?: SyncConfig;

  constructor(
    private readonly options: RepoManagerOptions,
    private readonly deps: RepoManagerDeps,
  ) {}

  private get logger() {
    return this.deps.logger;
  }

  private get fileSystem() {
    return this.deps.fileSystem;
  }

  async loadConfig(): Promise<SyncConfig> {
    this.logger.phase("Loading Configuration");
    this.config = await this.deps.phases.configLoader.load(
      this.options,
      this.logger,
      this.fileSystem,
    );
    return this.config;
  }

  async discoverWorkspace(): Promise<ProjectInventory> {
    const config = this.ensureConfigLoaded();
    this.logger.phase("Discovering Workspace");
    return await this.deps.phases.workspaceDiscovery.discover(
      config,
      this.options,
      this.logger,
      this.fileSystem,
    );
  }

  async scanImports(inventory: ProjectInventory): Promise<ProjectUsage> {
    const config = this.ensureConfigLoaded();
    this.logger.phase("Scanning Imports");
    return await this.deps.phases.importScanner.scan(
      inventory,
      config,
      this.options,
      this.logger,
      this.fileSystem,
    );
  }

  async resolveGraph(
    inventory: ProjectInventory,
    usage: ProjectUsage,
  ): Promise<ResolvedGraph> {
    const config = this.ensureConfigLoaded();
    this.logger.phase("Resolving Dependency Graph");
    return await this.deps.phases.graphResolver.resolve(
      inventory,
      usage,
      config,
      this.options,
      this.logger,
      this.fileSystem,
    );
  }

  async emitChanges(
    graph: ResolvedGraph,
    inventory: ProjectInventory,
  ): Promise<EmitResult> {
    const config = this.ensureConfigLoaded();
    this.logger.phase("Emitting Changes");
    return await this.deps.phases.changeEmitter.emit(
      graph,
      inventory,
      config,
      this.options,
      this.logger,
      this.fileSystem,
    );
  }

  get root(): string {
    return this.options.rootDir;
  }

  getConfigPath(): string | undefined {
    return this.options.configPath;
  }

  get isDryRun(): boolean {
    return this.options.dryRun ?? false;
  }

  isVerbose(): boolean {
    return this.options.verbose ?? false;
  }

  shouldFailOnStale(): boolean {
    return this.options.failOnStale ?? false;
  }

  getConfig(): SyncConfig {
    return this.ensureConfigLoaded();
  }

  private ensureConfigLoaded(): SyncConfig {
    if (!this.config) {
      throw new Error("Configuration must be loaded before running this phase");
    }
    return this.config;
  }
}
