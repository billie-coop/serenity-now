import type {
  FileSystemPort,
  GraphResolverPort,
  LoggerPort,
} from "../../core/ports.ts";
import type {
  Cycle,
  DiamondPattern,
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
  resolveEntryPoint?: (
    project: ProjectInfo,
    fs: FileSystemPort,
  ) => Promise<EntryPointInfo>;
}

export async function defaultEntryPointResolver(
  project: ProjectInfo,
  fs: FileSystemPort,
): Promise<EntryPointInfo> {
  const pkg = project.packageJson;
  const { join } = await import("@std/path");

  // Strategy 1: TypeScript source (preferred for tsconfig path mappings)
  const tsPatterns = ["src/index.ts", "src/index.tsx"];
  for (const pattern of tsPatterns) {
    const fullPath = join(project.root, pattern);
    if (await fs.fileExists(fullPath)) {
      return {
        path: pattern,
        exists: true,
        isTypeDefinition: false,
      };
    }
  }

  // Strategy 2: Explicit types/typings field
  if (pkg.types || pkg.typings) {
    const typesPath = pkg.types ?? pkg.typings;
    if (typesPath) {
      const fullPath = join(project.root, typesPath);
      const exists = await fs.fileExists(fullPath);
      return {
        path: typesPath,
        exists,
        isTypeDefinition: true,
      };
    }
  }

  // Strategy 3: Explicit exports field
  if (pkg.exports) {
    const exports = pkg.exports;
    if (typeof exports === "string") {
      const fullPath = join(project.root, exports);
      const exists = await fs.fileExists(fullPath);
      return {
        path: exports,
        exists,
        isTypeDefinition: exports.endsWith(".d.ts"),
      };
    }
    // Handle object exports
    if (typeof exports === "object" && !Array.isArray(exports)) {
      let defaultExport = exports["."] ?? exports.default ?? exports.import;

      // Handle nested conditional exports: { ".": { "import": "...", "require": "...", "types": "..." } }
      if (typeof defaultExport === "object" && !Array.isArray(defaultExport)) {
        // Prefer import over require for ESM compatibility
        defaultExport = defaultExport.import ?? defaultExport.require ??
          defaultExport.types ?? defaultExport.default;
      }

      if (typeof defaultExport === "string") {
        const fullPath = join(project.root, defaultExport);
        const exists = await fs.fileExists(fullPath);
        return {
          path: defaultExport,
          exists,
          isTypeDefinition: defaultExport.endsWith(".d.ts"),
        };
      }
    }
  }

  // Strategy 4: Explicit main/module field
  if (pkg.main || pkg.module) {
    const mainPath = pkg.module ?? pkg.main;
    if (mainPath) {
      const fullPath = join(project.root, mainPath);
      const exists = await fs.fileExists(fullPath);
      return {
        path: mainPath,
        exists,
        isTypeDefinition: mainPath.endsWith(".d.ts"),
      };
    }
  }

  // Strategy 5: Convention fallback (not guessing, but using standard convention)
  // This is the minimal safe assumption - if nothing is configured, assume standard layout
  return {
    path: "src/index.ts",
    exists: false,
    isTypeDefinition: false,
  };
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

function detectDiamondDependencies(
  projects: Record<string, ResolvedProject>,
  _inventory: ProjectInventory,
  config: SyncConfig,
  logger: LoggerPort,
): DiamondPattern[] {
  const patterns: DiamondPattern[] = [];
  const universalUtilities = new Set(config.universalUtilities ?? []);

  function getTransitiveDependencies(
    projectId: string,
    visited = new Set<string>(),
  ): Record<string, Set<string>> {
    const transitive: Record<string, Set<string>> = {};
    const project = projects[projectId];

    if (!project || visited.has(projectId)) {
      return transitive;
    }

    visited.add(projectId);

    for (const [depId, _dep] of Object.entries(project.dependencies)) {
      const depProject = projects[depId];
      if (depProject) {
        for (const subDepId of Object.keys(depProject.dependencies)) {
          if (!transitive[subDepId]) {
            transitive[subDepId] = new Set();
          }
          transitive[subDepId].add(depId);
        }

        const subTransitive = getTransitiveDependencies(depId, visited);
        for (
          const [subDepId, throughProjects] of Object.entries(subTransitive)
        ) {
          if (!transitive[subDepId]) {
            transitive[subDepId] = new Set();
          }
          transitive[subDepId].add(depId);
          for (const p of throughProjects) {
            transitive[subDepId].add(p);
          }
        }
      }
    }

    return transitive;
  }

  for (const [projectId, project] of Object.entries(projects)) {
    const directDeps = new Set(Object.keys(project.dependencies));
    const transitiveDeps = getTransitiveDependencies(projectId);

    for (const directDep of directDeps) {
      if (transitiveDeps[directDep]) {
        const transitiveThrough = Array.from(transitiveDeps[directDep] || []);

        let pattern: DiamondPattern["pattern"];
        let suggestion: string;

        if (universalUtilities.has(directDep)) {
          pattern = "universal-utility";
          suggestion =
            `This is expected - ${directDep} is designed to be used everywhere. No action needed.`;
        } else {
          const isUILayer = projectId.includes("ui") ||
            projectId.includes("components");
          const isDataLayer = directDep.includes("db") ||
            directDep.includes("data-sync");

          if (isUILayer && isDataLayer) {
            pattern = "potential-layering-violation";
            suggestion =
              `UI layer reaching into data layer while also using abstraction layers. Consider if ${projectId} should only use the abstraction layer.`;
          } else {
            pattern = "incomplete-abstraction";
            const throughList = transitiveThrough.slice(0, 2).join(", ");
            suggestion =
              `This may be intentional - ${throughList} uses ${directDep} internally but doesn't re-export all functionality. ` +
              `Consider if ${throughList} should provide a more complete abstraction.`;
          }
        }

        patterns.push({
          projectId,
          directDependency: directDep,
          transitiveThrough,
          pattern,
          suggestion,
        });

        logger.debug(
          `Diamond dependency in ${projectId}: ${directDep} imported directly and through ${
            transitiveThrough.join(", ")
          }`,
        );
      }
    }
  }

  return patterns;
}

export function createGraphResolver(
  deps: GraphResolverDeps = {},
): GraphResolverPort {
  const resolveEntryPoint = deps.resolveEntryPoint ?? defaultEntryPointResolver;

  return {
    async resolve(
      inventory: ProjectInventory,
      usage: ProjectUsage,
      config: SyncConfig,
      _options: RepoManagerOptions,
      logger: LoggerPort,
      fs: FileSystemPort,
    ): Promise<ResolvedGraph> {
      const resolved: ResolvedGraph = {
        projects: {},
        cycles: [],
        diamonds: [],
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
          // Skip self-references (internal imports within the same package)
          if (depId === projectId) {
            continue;
          }

          const dependencyProject = inventory.projects[depId];
          if (!dependencyProject) {
            warnings.push(
              `Project ${projectId} imports ${depId}, but it was not found in the workspace`,
            );
            continue;
          }
          const entryPoint = await resolveEntryPoint(dependencyProject, fs);

          // Warn if entry point doesn't exist (using fallback)
          if (!entryPoint.exists) {
            warnings.push(
              `Dependency ${depId} has no explicit entry point configured. Using convention: ${entryPoint.path}`,
            );
          }

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
      resolved.diamonds = detectDiamondDependencies(
        resolved.projects,
        inventory,
        config,
        logger,
      );
      resolved.warnings = warnings;

      if (resolved.diamonds.length > 0) {
        logger.info(
          `Detected ${resolved.diamonds.length} diamond dependency pattern(s)`,
        );
      }

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
