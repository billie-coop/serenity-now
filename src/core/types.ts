// Core domain models for the Serenity Now tool

// Type aliases for any types (following existing pattern in original codebase)
// deno-lint-ignore no-explicit-any
export type FixMe = any;
// deno-lint-ignore no-explicit-any
export type NoFix = any;

export interface RepoManagerOptions {
  rootDir: string;
  configPath?: string;
  dryRun?: boolean;
  verbose?: boolean;
  failOnStale?: boolean;
}

export type WorkspaceSubType =
  | "mobile"
  | "db"
  | "marketing"
  | "plugin"
  | "ui"
  | "website"
  | "library"
  | "other"
  | "unknown";

export interface WorkspaceTypeConfig {
  type: "app" | "shared-package";
  subType?: WorkspaceSubType;
  enforceNamePrefix?: string | false;
  packageJsonTemplate?: Partial<PackageJson>;
  tsconfigTemplate?: Partial<TsConfig>;
}

export interface SyncConfig {
  workspaceTypes?: Record<string, WorkspaceTypeConfig>;
  defaultDependencies?: string[];
  ignoreProjects?: string[];
  ignoreImports?: string[];
  excludePatterns?: string[];
  universalUtilities?: string[];
  enforceNamePrefix?: string;
  tsconfig?: {
    preserveOutDir?: boolean;
    typeOnlyInDevDependencies?: boolean;
    incremental?: boolean;
  };
}

export interface ProjectInfo {
  id: string;
  root: string;
  relativeRoot: string;
  packageJson: PackageJson;
  tsconfigPath?: string;
  workspaceType: "app" | "shared-package" | "unknown";
  workspaceSubType: WorkspaceSubType;
  workspaceConfig?: WorkspaceTypeConfig;
  isPrivate: boolean;
}

export interface ProjectInventory {
  projects: Record<string, ProjectInfo>;
  warnings: string[];
  workspaceConfigs: Record<string, WorkspaceTypeConfig>;
}

export interface UsageRecord {
  dependencyId: string;
  specifier: string;
  isTypeOnly: boolean;
  sourceFile: string;
}

export interface ProjectUsageRecord {
  dependencies: string[];
  typeOnlyDependencies: string[];
  usageDetails: UsageRecord[];
}

export interface ProjectUsage {
  usage: Record<string, ProjectUsageRecord>;
  warnings: string[];
}

export interface ResolvedDependency {
  dependency: ProjectInfo;
  entryPoint: EntryPointInfo;
  reason: "import" | "tsconfig-reference" | "default";
  sourceFiles: string[];
}

export interface ResolvedProject {
  project: ProjectInfo;
  dependencies: Record<string, ResolvedDependency>;
}

export interface Cycle {
  path: string[];
  projects: ProjectInfo[];
}

export interface ResolvedGraph {
  projects: Record<string, ResolvedProject>;
  cycles: Cycle[];
  warnings: string[];
}

export interface StaleDependencies {
  packageJsonDeps: string[];
  tsconfigPaths: string[];
  tsconfigReferences: string[];
}

export interface EmitResult {
  filesModified: number;
  projectsUpdated: string[];
  staleDependencies: Record<string, StaleDependencies>;
  diffs?: Record<string, string>;
  warnings: string[];
}

export interface PackageJson {
  name?: string;
  version?: string;
  type?: "module" | "commonjs";
  private?: boolean;
  workspaces?: string[] | { packages: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  types?: string;
  typings?: string;
  main?: string;
  module?: string;
  exports?: NoFix;
}

export interface TsConfig {
  extends?: string;
  compilerOptions?: {
    outDir?: string;
    rootDir?: string;
    paths?: Record<string, string[]>;
    composite?: boolean;
    incremental?: boolean;
    [key: string]: FixMe;
  };
  include?: string[];
  exclude?: string[];
  files?: string[];
  references?: Array<{ path: string }>;
}

export interface EntryPointInfo {
  path: string;
  exists: boolean;
  isTypeDefinition: boolean;
}
