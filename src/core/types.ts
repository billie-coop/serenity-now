// Core domain models for the Serenity Now tool

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface RepoManagerOptions {
	rootDir: string;
	configPath?: string;
	dryRun?: boolean;
	verbose?: boolean;
}

export const WORKSPACE_SUB_TYPES = [
	"mobile",
	"db",
	"marketing",
	"plugin",
	"ui",
	"website",
	"library",
	"other",
] as const;

export type WorkspaceSubType = (typeof WORKSPACE_SUB_TYPES)[number];

export type WorkspaceType = "app" | "shared-package";

export interface WorkspaceTypeConfig {
	type: WorkspaceType;
	subType?: WorkspaceSubType;
	enforceNamePrefix?: string;
	packageJsonTemplate?: JsonObject;
	tsconfigTemplate?: JsonObject;
	requiresTsconfig: boolean;
}

/** Fully validated configuration. Optional settings are normalized to their defaults. */
export interface SyncConfig {
	workspaceTypes: Record<string, WorkspaceTypeConfig>;
	workspaceDependencyVersion: string;
	defaultDependencies: string[];
	universalUtilities: string[];
	ignoreProjects: string[];
	ignoreImports: string[];
	excludePatterns: string[];
}

export interface PackageJson {
	name?: string;
	version?: string;
	private?: boolean;
	workspaces?: string[] | { packages?: string[] };
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	types?: string;
	typings?: string;
	main?: string;
	module?: string;
	exports?: JsonValue;
}

export interface TsConfig {
	extends?: string | string[];
	compilerOptions?: {
		paths?: Record<string, string[]>;
		[key: string]: JsonValue | undefined;
	};
	files?: string[];
	include?: string[];
	exclude?: string[];
	references?: Array<{ path: string }>;
}

export interface ProjectInfo {
	id: string;
	root: string;
	relativeRoot: string;
	packageJson: PackageJson;
	tsconfigPath?: string;
	workspaceType: WorkspaceType;
	workspaceSubType?: WorkspaceSubType;
	workspaceConfig: WorkspaceTypeConfig;
	isPrivate: boolean;
}

export interface ProjectInventory {
	projects: Record<string, ProjectInfo>;
}

// Source analysis

/** Which exports of the imported module a single import statement uses. */
export type ImportedBindings =
	| { kind: "named"; names: string[] }
	/** Every export may be used: `import * as`, `export *`, `import()`, `require()`. */
	| { kind: "namespace" }
	| { kind: "side-effect" };

/** An import of a workspace package found in a project's source files. */
export interface WorkspaceImport {
	dependencyId: string;
	specifier: string;
	/** Path relative to the importing project's root. */
	sourceFile: string;
	isTypeOnly: boolean;
	bindings: ImportedBindings;
}

export type ProjectScan =
	| { status: "scanned"; fileCount: number; imports: WorkspaceImport[] }
	/** The project's sources could not be read; it must not be modified. */
	| { status: "skipped"; reason: string };

export type EntryPointResolution =
	/** `path` is the TypeScript source entry point, relative to the project root. */
	| { status: "resolved"; path: string }
	| { status: "unresolved"; reason: string };

export interface ExportRecord {
	exportName: string;
	isTypeOnly: boolean;
	exportType: "named" | "default" | "namespace";
	/** Whether the export reaches the entry point through `export * from`. */
	isReExport: boolean;
}

export interface SourceAnalysis {
	projects: Record<string, ProjectScan>;
	entryPoints: Record<string, EntryPointResolution>;
	/** Whether each project's tsconfig.json sets `composite` (required to be referenced). */
	composite: Record<string, boolean>;
	/** Exports of each shared package's entry point (only when requested). */
	exports?: Record<string, ExportRecord[]>;
}

// Dependency graph

export interface ResolvedDependency {
	dependency: ProjectInfo;
	/** Source entry point, relative to the dependency's root. */
	entryPoint: string;
	reason: "import" | "default";
	sourceFiles: string[];
}

export interface ResolvedProject {
	project: ProjectInfo;
	/** False when the project's sources were not scanned; its files are left untouched. */
	scanned: boolean;
	dependencies: Record<string, ResolvedDependency>;
}

export interface Cycle {
	path: string[];
}

export interface DiamondPattern {
	projectId: string;
	directDependency: string;
	transitiveThrough: string[];
	pattern: "universal-utility" | "incomplete-abstraction";
}

export interface ResolvedGraph {
	projects: Record<string, ResolvedProject>;
	cycles: Cycle[];
	diamonds: DiamondPattern[];
}

// Emitting changes

export interface ChangeEntry {
	action: "add" | "remove" | "update";
	description: string;
}

export interface FileChange {
	projectId: string;
	filePath: string;
	changes: ChangeEntry[];
}

export interface EmitResult {
	fileChanges: FileChange[];
	skippedProjects: Array<{ projectId: string; reason: string }>;
}

// Unused exports

export interface PackageExportUsage {
	projectId: string;
	/** Other workspace projects that import this package. */
	importedBy: string[];
	/** True when some import may use every export (namespace import, `export *`, dynamic import). */
	usedWholesale: boolean;
	usedExports: string[];
	unusedExports: ExportRecord[];
	totalExports: number;
}
