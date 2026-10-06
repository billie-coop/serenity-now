import { resolveGraph } from "./graph.js";
import type { RepoManagerDeps, SourceAnalyzerOptions } from "./ports.js";
import type {
	EmitResult,
	ProjectInventory,
	RepoManagerOptions,
	ResolvedGraph,
	SourceAnalysis,
	SyncConfig,
} from "./types.js";

/**
 * Runs the phases of a sync in order: load config, discover the workspace,
 * analyze sources, resolve the dependency graph, and emit changes.
 */
export class RepoManager {
	private config?: SyncConfig;

	constructor(
		private readonly options: RepoManagerOptions,
		private readonly deps: RepoManagerDeps,
	) {}

	async loadConfig(): Promise<SyncConfig> {
		this.deps.logger.phase("Loading Configuration");
		this.config = await this.deps.phases.configLoader.load(
			this.options,
			this.deps.logger,
			this.deps.fileSystem,
		);
		return this.config;
	}

	async discoverWorkspace(): Promise<ProjectInventory> {
		const config = this.requireConfig();
		this.deps.logger.phase("Discovering Workspace");
		return await this.deps.phases.workspaceDiscovery.discover(
			config,
			this.options,
			this.deps.logger,
			this.deps.fileSystem,
		);
	}

	async analyzeSources(
		inventory: ProjectInventory,
		options: SourceAnalyzerOptions,
	): Promise<SourceAnalysis> {
		const config = this.requireConfig();
		this.deps.logger.phase("Analyzing Sources");
		return await this.deps.phases.sourceAnalyzer.analyze(
			inventory,
			config,
			options,
			this.deps.logger,
		);
	}

	resolveGraph(
		inventory: ProjectInventory,
		analysis: SourceAnalysis,
	): ResolvedGraph {
		const config = this.requireConfig();
		this.deps.logger.phase("Resolving Dependency Graph");
		const graph = resolveGraph(inventory, analysis, config);
		const edges = Object.values(graph.projects).reduce(
			(sum, p) => sum + Object.keys(p.dependencies).length,
			0,
		);
		this.deps.logger.info(
			`→ ${Object.keys(graph.projects).length} projects, ${edges} workspace dependencies`,
		);
		return graph;
	}

	async emitChanges(
		graph: ResolvedGraph,
		inventory: ProjectInventory,
	): Promise<EmitResult> {
		const config = this.requireConfig();
		this.deps.logger.phase(
			this.options.dryRun ? "Checking Files" : "Updating Files",
		);
		return await this.deps.phases.changeEmitter.emit(
			graph,
			inventory,
			config,
			this.options,
			this.deps.logger,
			this.deps.fileSystem,
		);
	}

	private requireConfig(): SyncConfig {
		if (!this.config) {
			throw new Error("Configuration must be loaded before running this phase");
		}
		return this.config;
	}
}
