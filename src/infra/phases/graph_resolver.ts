import type {
  FileSystemPort,
  GraphResolverPort,
  LoggerPort,
} from "../../core/ports.js";
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
} from "../../core/types.js";

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
  const { join } = await import("node:path");

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
      const rootExport = exports["."] ?? exports.default ?? exports.import;

      if (typeof rootExport === "string") {
        const fullPath = join(project.root, rootExport);
        const exists = await fs.fileExists(fullPath);
        return {
          path: rootExport,
          exists,
          isTypeDefinition: rootExport.endsWith(".d.ts"),
        };
      }

      if (rootExport && typeof rootExport === "object") {
        // Prefer import over require for ESM compatibility, then fall back to types/default
        const candidates = [
          rootExport.import,
          rootExport.require,
          rootExport.default,
          rootExport.types,
        ].filter((value): value is string => typeof value === "string");

        // Try each candidate and return the first one that exists
        for (const candidate of candidates) {
          const fullPath = join(project.root, candidate);
          const exists = await fs.fileExists(fullPath);
          if (exists) {
            return {
              path: candidate,
              exists: true,
              isTypeDefinition: candidate.endsWith(".d.ts"),
            };
          }
        }

        // If none exist, return the first candidate with exists=false
        if (candidates.length > 0) {
          return {
            path: candidates[0]!,
            exists: false,
            isTypeDefinition: candidates[0]!.endsWith(".d.ts"),
          };
        }
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

/**
 * Extracts the package name from an import specifier.
 * Handles both scoped and unscoped packages, stripping subpaths.
 *
 * Examples:
 * - "@scope/package" → "@scope/package"
 * - "@scope/package/src/file" → "@scope/package"
 * - "package" → "package"
 * - "package/subpath" → "package"
 */
function extractPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    // Scoped package: @scope/package or @scope/package/subpath
    const parts = specifier.split("/");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return specifier;
  } else {
    // Unscoped package: package or package/subpath
    const parts = specifier.split("/");
    return parts[0] ?? specifier;
  }
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

/**
 * Resolves an import specifier to a workspace package ID.
 * Returns the package ID if it's a workspace package, null if external.
 *
 * This uses the explicit inventory - no guessing or inference.
 */
function resolveWorkspaceDependencyId(
  specifier: string,
  inventory: ProjectInventory,
): string | null {
  // First check if it's an exact match (common case)
  if (inventory.projects[specifier]) {
    return specifier;
  }

  // Extract package name from deep imports (e.g., @scope/pkg/src/file → @scope/pkg)
  const packageName = extractPackageName(specifier);

  // Check if the extracted package name is in the workspace
  if (inventory.projects[packageName]) {
    return packageName;
  }

  // Not a workspace package - it's external
  return null;
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

          // Resolve to workspace package ID (handles deep imports, filters external packages)
          const workspacePackageId = resolveWorkspaceDependencyId(
            depId,
            inventory,
          );

          // Skip if not a workspace package (external dependency)
          if (!workspacePackageId) {
            continue;
          }

          // Skip if it's a self-reference via deep import
          if (workspacePackageId === projectId) {
            continue;
          }

          const dependencyProject = inventory.projects[workspacePackageId];
          if (!dependencyProject) {
            // This shouldn't happen since resolveWorkspaceDependencyId checks inventory
            // But keep as safety check
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

          // Use workspace package ID as key (consolidates deep imports)
          const existing = dependencies[workspacePackageId];
          if (existing) {
            // Merge source files if this package was already added (e.g., via different deep imports)
            existing.sourceFiles = Array.from(
              new Set([...existing.sourceFiles, ...sourceFiles]),
            );
          } else {
            dependencies[workspacePackageId] = {
              dependency: dependencyProject,
              entryPoint,
              reason: "import",
              sourceFiles,
            };
          }
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

      if (resolved.cycles.length > 0) {
        logger.warn(
          `⚠️  Found ${resolved.cycles.length} circular dependency cycle(s)!`,
        );
      } else {
        logger.info("→ No circular dependencies found");
      }

      if (resolved.diamonds.length > 0) {
        logger.info(
          `→ Detected ${resolved.diamonds.length} diamond dependency pattern(s)`,
        );
      }

      const totalDeps = Object.values(resolved.projects).reduce(
        (sum, project) => sum + Object.keys(project.dependencies).length,
        0,
      );
      logger.info(
        `✅ Resolved ${
          Object.keys(resolved.projects).length
        } projects with ${totalDeps} total dependencies`,
      );

      if (warnings.length > 0) {
        logger.warn(
          `Dependency resolution produced ${warnings.length} warning(s)`,
        );
      }

      return resolved;
    },
  };
}
