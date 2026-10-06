import type {
	EmitResult,
	ProjectInventory,
	RepoManagerOptions,
	ResolvedGraph,
	SourceAnalysis,
	SyncConfig,
} from "./types.js";

export interface LoggerPort {
	phase(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	debug(message: string): void;
	success(message: string): void;
	/** Every warning logged so far. */
	getWarnings(): string[];
}

export interface FileSystemPort {
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

export interface SourceAnalyzerOptions {
	/** Also collect the exports of every shared package's entry point. */
	includeExports: boolean;
}

/** Reads every project's TypeScript sources (imports, entry points, exports). */
export interface SourceAnalyzerPort {
	analyze(
		inventory: ProjectInventory,
		config: SyncConfig,
		options: SourceAnalyzerOptions,
		logger: LoggerPort,
	): Promise<SourceAnalysis>;
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
	sourceAnalyzer: SourceAnalyzerPort;
	changeEmitter: ChangeEmitterPort;
}

export interface RepoManagerDeps {
	logger: LoggerPort;
	fileSystem: FileSystemPort;
	phases: PhasePorts;
}
