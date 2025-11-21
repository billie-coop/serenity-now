// Dependency graph resolution and validation for the sync-deps tool
// Phase 3: Builds final dependency graph from import usage

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../utils/logging';
import type {
  Cycle,
  EntryPointInfo,
  ProjectInfo,
  ProjectInventory,
  ProjectUsage,
  ResolvedDependency,
  ResolvedGraph,
  ResolvedProject,
  SyncConfig,
} from '../core/types';

/**
 * Resolves the entry point for a dependency
 * Uses a cascade of strategies to find the best entry point
 */
async function resolveEntryPoint(
  dependency: ProjectInfo,
  options: { verbose?: boolean } = {},
): Promise<EntryPointInfo> {
  const { verbose = false } = options;

  // Strategy 1: PREFER TypeScript source files (for tsconfig path mappings)
  // Check if src/index.ts or src/index.tsx exists - this is what TypeScript needs
  const tsSourcePatterns = ['src/index.ts', 'src/index.tsx'];
  for (const pattern of tsSourcePatterns) {
    const sourcePath = join(dependency.root, pattern);
    if (existsSync(sourcePath)) {
      if (verbose) {
        log.debug(`  Entry point for ${dependency.id}: ${pattern} (TypeScript source)`);
      }
      return {
        path: pattern,
        exists: true,
        isTypeDefinition: false,
      };
    }
  }

  // Strategy 2: Check package.json types/typings field (for packages with .d.ts files)
  if (dependency.packageJson.types) {
    const typePath = join(dependency.root, dependency.packageJson.types);
    if (existsSync(typePath)) {
      if (verbose) {
        log.debug(
          `  Entry point for ${dependency.id}: ${dependency.packageJson.types} (from types field)`,
        );
      }
      return {
        path: dependency.packageJson.types,
        exists: true,
        isTypeDefinition: true,
      };
    }
  }

  if (dependency.packageJson.typings) {
    const typePath = join(dependency.root, dependency.packageJson.typings);
    if (existsSync(typePath)) {
      if (verbose) {
        log.debug(
          `  Entry point for ${dependency.id}: ${dependency.packageJson.typings} (from typings field)`,
        );
      }
      return {
        path: dependency.packageJson.typings,
        exists: true,
        isTypeDefinition: true,
      };
    }
  }

  // Strategy 3: Check package.json exports field (modern packages)
  if (dependency.packageJson.exports) {
    const exports = dependency.packageJson.exports;

    // Handle string export
    if (typeof exports === 'string') {
      const exportPath = join(dependency.root, exports);
      if (existsSync(exportPath)) {
        if (verbose) {
          log.debug(`  Entry point for ${dependency.id}: ${exports} (from exports field)`);
        }
        return {
          path: exports,
          exists: true,
          isTypeDefinition: exports.endsWith('.d.ts'),
        };
      }
    }

    // Handle object export with conditions
    if (typeof exports === 'object' && exports !== null) {
      // Check for types export first
      if (exports.types && typeof exports.types === 'string') {
        const typePath = join(dependency.root, exports.types);
        if (existsSync(typePath)) {
          if (verbose) {
            log.debug(`  Entry point for ${dependency.id}: ${exports.types} (from exports.types)`);
          }
          return {
            path: exports.types,
            exists: true,
            isTypeDefinition: true,
          };
        }
      }

      // Check for default export
      const defaultExport = exports.default || exports['.'] || exports.import || exports.require;
      if (defaultExport && typeof defaultExport === 'string') {
        const exportPath = join(dependency.root, defaultExport);
        if (existsSync(exportPath)) {
          if (verbose) {
            log.debug(`  Entry point for ${dependency.id}: ${defaultExport} (from exports field)`);
          }
          return {
            path: defaultExport,
            exists: true,
            isTypeDefinition: defaultExport.endsWith('.d.ts'),
          };
        }
      }
    }
  }

  // Strategy 4: Check package.json main/module fields
  const mainField = dependency.packageJson.module || dependency.packageJson.main;
  if (mainField) {
    const mainPath = join(dependency.root, mainField);
    if (existsSync(mainPath)) {
      if (verbose) {
        log.debug(`  Entry point for ${dependency.id}: ${mainField} (from main/module field)`);
      }
      return {
        path: mainField,
        exists: true,
        isTypeDefinition: mainField.endsWith('.d.ts'),
      };
    }
  }

  // Strategy 5: Common patterns (fallback)
  const commonPatterns = [
    'src/index.js',
    'src/index.jsx',
    'index.ts',
    'index.tsx',
    'index.js',
    'index.jsx',
    'lib/index.js',
    'lib/index.ts',
    'dist/index.js',
    'dist/index.d.ts',
  ];

  for (const pattern of commonPatterns) {
    const fullPath = join(dependency.root, pattern);
    if (existsSync(fullPath)) {
      if (verbose) {
        log.debug(`  Entry point for ${dependency.id}: ${pattern} (common pattern)`);
      }
      return {
        path: pattern,
        exists: true,
        isTypeDefinition: pattern.endsWith('.d.ts'),
      };
    }
  }

  // Fallback: Use src/index.ts as convention even if it doesn't exist yet
  if (verbose) {
    log.debug(`  Entry point for ${dependency.id}: src/index.ts (fallback convention)`);
  }
  return {
    path: 'src/index.ts',
    exists: false,
    isTypeDefinition: false,
  };
}

/**
 * Checks for architectural violations (apps being imported)
 */
function checkArchitecturalViolations(
  projectId: string,
  _project: ProjectInfo,
  dependencies: Record<string, ResolvedDependency>,
  inventory: ProjectInventory,
): string[] {
  const warnings: string[] = [];

  for (const [depId, dep] of Object.entries(dependencies)) {
    const depInfo = inventory.projects[depId];
    if (depInfo && depInfo.workspaceType === 'app') {
      warnings.push(
        `Architectural violation in ${projectId}: ` +
          `Importing from app '${depId}' (apps should never be imported). ` +
          `Source files: ${dep.sourceFiles.join(', ')}`,
      );
    }
  }

  return warnings;
}

/**
 * Diamond dependency pattern information
 */
interface DiamondPattern {
  projectId: string;
  directDependency: string;
  transitiveThrough: string[];
  pattern: 'universal-utility' | 'incomplete-abstraction' | 'potential-layering-violation';
  suggestion: string;
}

/**
 * Detects diamond dependencies where a project imports a package both directly
 * and transitively through another dependency
 */
function detectDiamondDependencies(
  projects: Record<string, ResolvedProject>,
  _inventory: ProjectInventory,
  verbose: boolean,
): DiamondPattern[] {
  const patterns: DiamondPattern[] = [];

  // Universal utilities that are expected to be imported everywhere
  const universalUtilities = new Set([
    '@billie-coop/ts-utils',
    '@billie-coop/date-utils',
    '@billie-coop/math-utils',
  ]);

  // Build a map of each project's transitive dependencies
  function getTransitiveDependencies(
    projectId: string,
    visited: Set<string> = new Set(),
  ): Record<string, Set<string>> {
    const transitive: Record<string, Set<string>> = {};

    const project = projects[projectId];
    if (!project || visited.has(projectId)) {
      return transitive;
    }

    visited.add(projectId);

    for (const [depId, _dep] of Object.entries(project.dependencies)) {
      // Get this dependency's dependencies
      const depProject = projects[depId];
      if (depProject) {
        for (const subDepId of Object.keys(depProject.dependencies)) {
          if (!transitive[subDepId]) {
            transitive[subDepId] = new Set();
          }
          transitive[subDepId].add(depId);
        }

        // Recursively get transitive dependencies
        const subTransitive = getTransitiveDependencies(depId, visited);
        for (const [subDepId, throughProjects] of Object.entries(subTransitive)) {
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

  // Check each project for diamond dependencies
  for (const [projectId, project] of Object.entries(projects)) {
    const directDeps = new Set(Object.keys(project.dependencies));
    const transitiveDeps = getTransitiveDependencies(projectId);

    // Find diamonds: dependencies that are both direct and transitive
    for (const directDep of directDeps) {
      if (transitiveDeps[directDep]) {
        const transitiveThrough = Array.from(transitiveDeps[directDep] || []);

        // Classify the pattern
        let pattern: DiamondPattern['pattern'];
        let suggestion: string;

        if (universalUtilities.has(directDep)) {
          pattern = 'universal-utility';
          suggestion = `This is expected - ${directDep} is designed to be used everywhere. No action needed.`;
        } else {
          // Check if it's a potential layering violation
          // const _projectInfo = inventory.projects[projectId];
          // const _depInfo = inventory.projects[directDep];

          const isUILayer = projectId.includes('ui') || projectId.includes('components');
          const isDataLayer = directDep.includes('db') || directDep.includes('data-sync');

          if (isUILayer && isDataLayer) {
            pattern = 'potential-layering-violation';
            suggestion = `UI layer reaching into data layer while also using abstraction layers. Consider if ${projectId} should only use the abstraction layer.`;
          } else {
            pattern = 'incomplete-abstraction';
            const throughList = transitiveThrough.slice(0, 2).join(', ');
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

        if (verbose) {
          log.debug(
            `  Diamond dependency in ${projectId}: ${directDep} imported directly and through ${transitiveThrough.join(', ')}`,
          );
        }
      }
    }
  }

  return patterns;
}

/**
 * Detects circular dependencies using DFS
 */
function detectCircularDependencies(
  projects: Record<string, ResolvedProject>,
  verbose: boolean,
): Cycle[] {
  const cycles: Cycle[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(projectId: string): boolean {
    visited.add(projectId);
    recursionStack.add(projectId);
    path.push(projectId);

    const project = projects[projectId];
    if (!project) {
      path.pop();
      recursionStack.delete(projectId);
      return false;
    }

    for (const depId of Object.keys(project.dependencies)) {
      if (!visited.has(depId)) {
        if (dfs(depId)) {
          return true;
        }
      } else if (recursionStack.has(depId)) {
        // Found a cycle
        const cycleStart = path.indexOf(depId);
        const cyclePath = [...path.slice(cycleStart), depId];

        // Only add if this exact cycle hasn't been found yet
        const cycleKey = cyclePath.slice().sort().join('->');
        const existingCycle = cycles.find((c) => c.path.slice().sort().join('->') === cycleKey);

        if (!existingCycle) {
          const cycleProjects = cyclePath
            .map((id) => projects[id]?.project)
            .filter(Boolean) as ProjectInfo[];
          cycles.push({
            path: cyclePath,
            projects: cycleProjects,
          });

          if (verbose) {
            log.debug(`  Found cycle: ${cyclePath.join(' → ')}`);
          }
        }
      }
    }

    path.pop();
    recursionStack.delete(projectId);
    return false;
  }

  // Run DFS from each unvisited node
  for (const projectId of Object.keys(projects)) {
    if (!visited.has(projectId)) {
      dfs(projectId);
    }
  }

  return cycles;
}

/**
 * Builds the dependency graph from inventory and usage
 */
export async function resolveGraph(
  inventory: ProjectInventory,
  usage: ProjectUsage,
  config: SyncConfig,
  options: { verbose?: boolean } = {},
): Promise<ResolvedGraph> {
  const { verbose = false } = options;
  const warnings: string[] = [];
  const projects: Record<string, ResolvedProject> = {};

  log.step('Building dependency graph...');

  // Process each project
  for (const [projectId, projectInfo] of Object.entries(inventory.projects)) {
    if (verbose) {
      log.debug(`Processing ${projectId}...`);
    }

    // Skip ignored projects
    if (config.ignoreProjects?.includes(projectId)) {
      if (verbose) {
        log.debug(`  Skipping ignored project`);
      }
      continue;
    }

    const dependencies: Record<string, ResolvedDependency> = {};

    // 1. Add dependencies from actual imports (Phase 2 results)
    const projectUsage = usage.usage[projectId];
    if (projectUsage) {
      // Process runtime dependencies
      for (const depId of projectUsage.dependencies) {
        const depInfo = inventory.projects[depId];
        if (!depInfo) {
          warnings.push(`Dependency ${depId} not found in inventory for ${projectId}`);
          continue;
        }

        const sourceFiles = projectUsage.usageDetails
          .filter((u) => u.dependencyId === depId && !u.isTypeOnly)
          .map((u) => u.sourceFile);

        const entryPoint = await resolveEntryPoint(depInfo, { verbose });

        dependencies[depId] = {
          dependency: depInfo,
          entryPoint,
          reason: 'import',
          sourceFiles,
        };
      }

      // Process type-only dependencies
      for (const depId of projectUsage.typeOnlyDependencies) {
        // Skip if already added as runtime dependency
        if (dependencies[depId]) {
          continue;
        }

        const depInfo = inventory.projects[depId];
        if (!depInfo) {
          warnings.push(`Type dependency ${depId} not found in inventory for ${projectId}`);
          continue;
        }

        const sourceFiles = projectUsage.usageDetails
          .filter((u) => u.dependencyId === depId && u.isTypeOnly)
          .map((u) => u.sourceFile);

        const entryPoint = await resolveEntryPoint(depInfo, { verbose });

        dependencies[depId] = {
          dependency: depInfo,
          entryPoint,
          reason: 'import',
          sourceFiles,
        };
      }
    }

    // 2. Add default dependencies from config
    if (config.defaultDependencies) {
      for (const defaultDep of config.defaultDependencies) {
        // Don't add if project IS the dependency
        if (defaultDep === projectId) {
          continue;
        }

        // Don't add if already present
        if (dependencies[defaultDep]) {
          continue;
        }

        const depInfo = inventory.projects[defaultDep];
        if (!depInfo) {
          warnings.push(`Default dependency ${defaultDep} not found in inventory`);
          continue;
        }

        const entryPoint = await resolveEntryPoint(depInfo, { verbose });

        dependencies[defaultDep] = {
          dependency: depInfo,
          entryPoint,
          reason: 'default',
          sourceFiles: [],
        };

        if (verbose) {
          log.debug(`  Added default dependency: ${defaultDep}`);
        }
      }
    }

    // NOTE: We do NOT add dependencies from tsconfig references
    // tsconfig references are for TypeScript compilation, not actual imports
    // Only actual code imports should become dependencies

    // 4. Check for architectural violations
    const violations = checkArchitecturalViolations(
      projectId,
      projectInfo,
      dependencies,
      inventory,
    );
    warnings.push(...violations);

    // Create resolved project
    projects[projectId] = {
      project: projectInfo,
      dependencies,
    };

    if (verbose && Object.keys(dependencies).length > 0) {
      log.debug(`  Resolved ${Object.keys(dependencies).length} dependencies`);
    }
  }

  // 5. Detect circular dependencies
  log.step('Checking for circular dependencies...');
  const cycles = detectCircularDependencies(projects, verbose);

  if (cycles.length > 0) {
    log.warn(`Found ${cycles.length} circular dependencies`);
    for (const cycle of cycles) {
      log.warn(`  Cycle: ${cycle.path.join(' → ')}`);
    }
  } else {
    log.success('No circular dependencies found');
  }

  // 6. Detect diamond dependencies
  log.step('Checking for diamond dependencies...');
  const diamondPatterns = detectDiamondDependencies(projects, inventory, verbose);

  if (diamondPatterns.length > 0) {
    // Group by pattern type
    const byPattern = {
      'universal-utility': diamondPatterns.filter((p) => p.pattern === 'universal-utility'),
      'incomplete-abstraction': diamondPatterns.filter(
        (p) => p.pattern === 'incomplete-abstraction',
      ),
      'potential-layering-violation': diamondPatterns.filter(
        (p) => p.pattern === 'potential-layering-violation',
      ),
    };

    log.info(`Found ${diamondPatterns.length} diamond dependencies:`);

    if (byPattern['universal-utility'].length > 0) {
      log.info(`  Universal utilities (expected): ${byPattern['universal-utility'].length}`);
      if (verbose) {
        for (const pattern of byPattern['universal-utility'].slice(0, 3)) {
          log.debug(`    ${pattern.projectId} → ${pattern.directDependency}`);
        }
      }
    }

    // Show all non-universal patterns in detail
    const nonUniversalPatterns = [
      ...byPattern['incomplete-abstraction'],
      ...byPattern['potential-layering-violation'],
    ];

    if (nonUniversalPatterns.length > 0) {
      log.info(`  Non-universal diamond dependencies: ${nonUniversalPatterns.length}`);
      log.info('');

      // Group by project for better readability
      const byProject: Record<string, typeof nonUniversalPatterns> = {};
      for (const pattern of nonUniversalPatterns) {
        if (!byProject[pattern.projectId]) {
          byProject[pattern.projectId] = [];
        }
        byProject[pattern.projectId]!.push(pattern);
      }

      // Show all patterns grouped by project
      for (const [projectId, patterns] of Object.entries(byProject)) {
        log.info(`  📦 ${projectId}:`);
        for (const pattern of patterns) {
          log.info(`      → ${pattern.directDependency}`);
          log.info(`        (also via: ${pattern.transitiveThrough.join(', ')})`);
          if (pattern.pattern === 'potential-layering-violation') {
            log.warn(`        ⚠️  ${pattern.suggestion}`);
          }
        }
        log.info('');
      }
    }
  } else {
    log.success('No diamond dependencies detected');
  }

  // Report statistics
  const totalDeps = Object.values(projects).reduce(
    (sum, p) => sum + Object.keys(p.dependencies).length,
    0,
  );

  log.success(
    `Resolved ${Object.keys(projects).length} projects with ${totalDeps} total dependencies`,
  );

  if (warnings.length > 0) {
    log.warn(`${warnings.length} warnings during graph resolution`);
    if (verbose) {
      for (const w of warnings) {
        log.debug(`  ${w}`);
      }
    }
  }

  return {
    projects,
    cycles,
    warnings,
  };
}

/**
 * Analyzes the resolved graph and provides insights
 */
export function analyzeGraph(
  graph: ResolvedGraph,
  _inventory: ProjectInventory,
  verbose: boolean,
): void {
  if (!verbose) {
    return;
  }

  log.section('Dependency Graph Analysis');

  // Find projects with most dependencies
  const projectDeps = Object.entries(graph.projects)
    .map(([id, project]) => ({ id, count: Object.keys(project.dependencies).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (projectDeps.length > 0) {
    log.info('Projects with most dependencies:');
    for (const { id, count } of projectDeps) {
      log.info(`  ${id}: ${count} dependencies`);
    }
  }

  // Find most depended-upon packages
  const dependedUpon: Record<string, number> = {};
  for (const project of Object.values(graph.projects)) {
    for (const depId of Object.keys(project.dependencies)) {
      dependedUpon[depId] = (dependedUpon[depId] || 0) + 1;
    }
  }

  const mostDepended = Object.entries(dependedUpon)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (mostDepended.length > 0) {
    log.info('Most depended-upon packages:');
    for (const [id, count] of mostDepended) {
      log.info(`  ${id}: ${count} projects depend on it`);
    }
  }

  // Report architectural violations
  const violations = graph.warnings.filter((w) => w.includes('Architectural violation'));
  if (violations.length > 0) {
    log.warn(`Found ${violations.length} architectural violations:`);
    for (const violation of violations) {
      log.warn(`  ${violation}`);
    }
  }
}
