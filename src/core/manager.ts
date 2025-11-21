// Core orchestrator class for the sync-deps tool

import { loadSyncConfig } from '../config/loader';
import { emitChanges } from '../emitter/emit';
import { analyzeGraph, resolveGraph } from '../resolver/graph';
import { analyzeImportUsage, scanProjectImports } from '../scanner/imports';
import { Logger } from '../utils/logging';
import type {
  EmitResult,
  EntryPointInfo,
  PackageJson,
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedGraph,
  SyncConfig,
  TsConfig,
} from './types';
import { fileExists, readJson, writeJson } from '../utils/files';
import { discoverWorkspaceProjects } from '../scanner/workspace';

export class RepoManager {
  private rootDir: string;
  private configPath?: string;
  private dryRun: boolean;
  private verbose: boolean;
  private failOnStale: boolean;
  private logger: Logger;
  private config?: SyncConfig;

  // Caches
  private packageJsonCache = new Map<string, PackageJson>();
  private tsConfigCache = new Map<string, TsConfig>();

  constructor(options: RepoManagerOptions) {
    this.rootDir = options.rootDir;
    this.configPath = options.configPath;
    this.dryRun = options.dryRun ?? false;
    this.verbose = options.verbose ?? false;
    this.failOnStale = options.failOnStale ?? false;
    this.logger = new Logger(this.verbose);
  }

  // Phase hooks (to be implemented by phase modules)
  async loadConfig(): Promise<SyncConfig> {
    this.logger.phase('Loading Configuration');
    this.config = await loadSyncConfig(this);
    return this.config;
  }

  async discoverWorkspace(): Promise<ProjectInventory> {
    if (!this.config) {
      throw new Error('Config must be loaded before workspace discovery');
    }
    this.logger.phase('Discovering Workspace');
    return discoverWorkspaceProjects(this, this.config);
  }

  async scanImports(inventory: ProjectInventory): Promise<ProjectUsage> {
    if (!this.config) {
      throw new Error('Config must be loaded before import scanning');
    }
    this.logger.phase('Scanning Imports');

    const usage = await scanProjectImports(inventory, this.config, {
      verbose: this.verbose,
    });

    // Optionally analyze and display import statistics
    if (this.verbose) {
      analyzeImportUsage(usage, inventory, this.verbose);
    }

    return usage;
  }

  async resolveGraph(inventory: ProjectInventory, usage: ProjectUsage): Promise<ResolvedGraph> {
    if (!this.config) {
      throw new Error('Config must be loaded before graph resolution');
    }
    this.logger.phase('Resolving Dependency Graph');

    const graph = await resolveGraph(inventory, usage, this.config, {
      verbose: this.verbose,
    });

    // Optionally analyze and display graph statistics
    if (this.verbose) {
      analyzeGraph(graph, inventory, this.verbose);
    }

    return graph;
  }

  async emitChanges(graph: ResolvedGraph): Promise<EmitResult> {
    if (!this.config) {
      throw new Error('Config must be loaded before emitting changes');
    }
    this.logger.phase('Emitting Changes');

    const result = await emitChanges(graph, this.config, {
      dryRun: this.dryRun,
      verbose: this.verbose,
    });

    return result;
  }

  // Utilities
  get root(): string {
    return this.rootDir;
  }

  getConfigPath(): string | undefined {
    return this.configPath;
  }

  get isDryRun(): boolean {
    return this.dryRun;
  }

  isVerbose(): boolean {
    return this.verbose;
  }

  shouldFailOnStale(): boolean {
    return this.failOnStale;
  }

  getLogger(): Logger {
    return this.logger;
  }

  logVerbose(message: string): void {
    this.logger.debug(message);
  }

  // File operations
  async readJson<T>(filePath: string): Promise<T> {
    return readJson<T>(filePath);
  }

  async writeJson(filePath: string, value: unknown): Promise<void> {
    if (this.dryRun) {
      this.logger.debug(`[dry-run] Would write to ${filePath}`);
      return;
    }
    return writeJson(filePath, value);
  }

  async fileExists(filePath: string): Promise<boolean> {
    return fileExists(filePath);
  }

  // Cache accessors
  async getPackageJson(projectId: string): Promise<PackageJson | null> {
    if (!this.packageJsonCache.has(projectId)) {
      // Will need project root from inventory to implement properly
      return null;
    }
    return this.packageJsonCache.get(projectId) ?? null;
  }

  async getTsConfig(projectId: string): Promise<TsConfig | null> {
    if (!this.tsConfigCache.has(projectId)) {
      // Will need project root from inventory to implement properly
      return null;
    }
    return this.tsConfigCache.get(projectId) ?? null;
  }

  async getDependencyEntry(
    _projectId: string,
    _dependencyId: string,
  ): Promise<EntryPointInfo | null> {
    // Placeholder - will be implemented when we have inventory
    return null;
  }
}
