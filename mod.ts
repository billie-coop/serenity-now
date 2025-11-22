// Public API surface for consumers of Serenity Now

export { RepoManager } from "./src/core/repo_manager.ts";
export type { RepoManagerDeps } from "./src/core/ports.ts";

export type {
  EmitResult,
  EntryPointInfo,
  PackageJson,
  ProjectInfo,
  ProjectInventory,
  ProjectUsage,
  ProjectUsageRecord,
  RepoManagerOptions,
  ResolvedDependency,
  ResolvedGraph,
  ResolvedProject,
  SyncConfig,
  TsConfig,
  WorkspaceSubType,
  WorkspaceTypeConfig,
} from "./src/core/types.ts";
