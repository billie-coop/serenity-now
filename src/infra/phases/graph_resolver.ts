import type { GraphResolverPort, LoggerPort } from "../../core/ports.ts";
import type {
  Cycle,
  EntryPointInfo,
  ProjectInfo,
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedDependency,
  ResolvedGraph,
  ResolvedProject,
  SyncConfig,
} from "../../core/types.ts";

interface GraphResolverDeps {
  resolveEntryPoint?: (project: ProjectInfo) => Promise<EntryPointInfo>;
}

function defaultEntryPointResolver(
  project: ProjectInfo,
): Promise<EntryPointInfo> {
  const pkg = project.packageJson;
  const main = pkg.main ?? pkg.module ?? "src/index.ts";
  const types = pkg.types ?? pkg.typings;
  return Promise.resolve({
    path: main,
    exists: true,
    isTypeDefinition: Boolean(types && main === types),
  });
}

function collectDependencies(record?: ProjectUsage["usage"][string]): string[] {
  if (!record) return [];
  return Array.from(
    new Set([
      ...record.dependencies,
      ...record.typeOnlyDependencies,
    ]),
  );
}

function collectSourceFiles(
  record: ProjectUsage["usage"][string] | undefined,
  dependencyId: string,
): string[] {
  if (!record) return [];
  return record.usageDetails
    .filter((detail) => detail.dependencyId === dependencyId)
    .map((detail) => detail.sourceFile);
}

function detectCycles(projects: Record<string, ResolvedProject>): Cycle[] {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles: Cycle[] = [];

  function dfs(projectId: string, path: string[]): void {
    if (stack.has(projectId)) {
      const cycleStart = path.indexOf(projectId);
      if (cycleStart >= 0) {
        const cyclePath = path.slice(cycleStart);
        cyclePath.push(projectId);
        const projectsInCycle = cyclePath.map((id) => projects[id]?.project)
          .filter(Boolean) as ProjectInfo[];
        cycles.push({
          path: cyclePath,
          projects: projectsInCycle,
        });
      }
      return;
    }

    if (visited.has(projectId)) {
      return;
    }

    visited.add(projectId);
    stack.add(projectId);

    const node = projects[projectId];
    if (node) {
      for (const depId of Object.keys(node.dependencies)) {
        dfs(depId, [...path, projectId]);
      }
    }

    stack.delete(projectId);
  }

  for (const projectId of Object.keys(projects)) {
    if (!visited.has(projectId)) {
      dfs(projectId, []);
    }
  }

  return cycles;
}

export function createGraphResolver(
  deps: GraphResolverDeps = {},
): GraphResolverPort {
  const resolveEntryPoint = deps.resolveEntryPoint ?? defaultEntryPointResolver;

  return {
    async resolve(
      inventory: ProjectInventory,
      usage: ProjectUsage,
      _config: SyncConfig,
      _options: RepoManagerOptions,
      logger: LoggerPort,
    ): Promise<ResolvedGraph> {
      const resolved: ResolvedGraph = {
        projects: {},
        cycles: [],
        warnings: [],
      };
      const warnings: string[] = [];

      for (
        const [projectId, projectInfo] of Object.entries(
          inventory.projects,
        )
      ) {
        const usageRecord = usage.usage[projectId];
        const dependencies: Record<string, ResolvedDependency> = {};

        for (const depId of collectDependencies(usageRecord)) {
          const dependencyProject = inventory.projects[depId];
          if (!dependencyProject) {
            warnings.push(
              `Project ${projectId} imports ${depId}, but it was not found in the workspace`,
            );
            continue;
          }
          const entryPoint = await resolveEntryPoint(dependencyProject);
          const sourceFiles = collectSourceFiles(usageRecord, depId);
          dependencies[depId] = {
            dependency: dependencyProject,
            entryPoint,
            reason: "import",
            sourceFiles,
          };
        }

        resolved.projects[projectId] = {
          project: projectInfo,
          dependencies,
        };
      }

      resolved.cycles = detectCycles(resolved.projects);
      resolved.warnings = warnings;
      if (warnings.length > 0) {
        logger.warn(
          `Dependency resolution produced ${warnings.length} warning(s)`,
        );
      } else {
        logger.info("Dependency graph resolved without warnings");
      }

      return resolved;
    },
  };
}
