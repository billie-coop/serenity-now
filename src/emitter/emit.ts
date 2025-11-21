// Emit changes to package.json and tsconfig.json files
// Phase 4: Updates configurations based on resolved dependency graph

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { log } from '../utils/logging';
import type {
  EmitResult,
  PackageJson,
  ResolvedGraph,
  ResolvedProject,
  StaleDependencies,
  SyncConfig,
  TsConfig,
} from '../core/types';

// Define MoonYml interface (temporary - will be removed once we fully transition to new tooling)
interface MoonYml {
  $schema?: string;
  language?: string;
  dependsOn?: string[];
  [key: string]: unknown;
}

/**
 * Simple YAML parser for moon.yml files
 * NOTE: This is temporary - will be removed once we fully transition from Moon to the new tooling
 */
function parseMoonYml(content: string): MoonYml {
  const lines = content.split('\n');
  const result: MoonYml = {};
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Handle array items
    if (trimmed.startsWith('- ')) {
      if (currentKey === 'dependsOn') {
        const value = trimmed.slice(2).trim();
        // Remove quotes if present
        currentArray.push(value.replace(/^['"]|['"]$/g, ''));
      }
      continue;
    }

    // Save previous array if we're moving to a new key
    if (currentKey === 'dependsOn' && currentArray.length > 0) {
      result.dependsOn = currentArray;
      currentArray = [];
    }

    // Handle key-value pairs
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      currentKey = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();

      if (value) {
        // Remove quotes if present
        result[currentKey] = value.replace(/^['"]|['"]$/g, '');
      } else if (currentKey === 'dependsOn') {
        // Start collecting array items
        currentArray = [];
      }
    }
  }

  // Save final array if exists
  if (currentKey === 'dependsOn' && currentArray.length > 0) {
    result.dependsOn = currentArray;
  }

  return result;
}

/**
 * Formats a MoonYml object back to YAML string
 * NOTE: This is temporary - will be removed once we fully transition from Moon to the new tooling
 */
function formatMoonYml(moonYml: MoonYml): string {
  const lines: string[] = [];

  // Always write $schema first if present
  if (moonYml.$schema) {
    lines.push(`$schema: '${moonYml.$schema}'`);
    lines.push('');
  }

  // Write language if present
  if (moonYml.language) {
    lines.push(`language: '${moonYml.language}'`);
    lines.push('');
  }

  // Write dependsOn array
  if (moonYml.dependsOn && moonYml.dependsOn.length > 0) {
    lines.push('dependsOn:');
    for (const dep of moonYml.dependsOn) {
      lines.push(`  - '${dep}'`);
    }
    lines.push('');
  }

  // Write any other fields that we're preserving
  for (const [key, value] of Object.entries(moonYml)) {
    if (key !== '$schema' && key !== 'language' && key !== 'dependsOn') {
      if (typeof value === 'string') {
        lines.push(`${key}: '${value}'`);
      } else if (value !== undefined) {
        // For now, just stringify other types
        lines.push(`${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  // Ensure we end with a newline
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Updates moon.yml with resolved dependencies
 * NOTE: This is temporary - will be removed once we fully transition from Moon to the new tooling
 * We're keeping Moon in sync for now to maintain compatibility during the transition period
 */
function updateMoonYml(
  project: ResolvedProject,
  currentMoonYml: MoonYml | null,
  config: SyncConfig,
): { updated: MoonYml; changed: boolean } | null {
  if (!currentMoonYml) {
    return null;
  }

  // Create a copy of the current moon.yml to preserve other fields
  const updated = JSON.parse(JSON.stringify(currentMoonYml));

  // Build new dependsOn array from our resolved graph
  // Moon uses package names without the @billie-coop/ prefix
  const allDeps = Object.keys(project.dependencies).map((depId) =>
    depId.replace('@billie-coop/', ''),
  );

  // Separate default dependencies from regular ones
  const defaultDepsSet = new Set(
    (config.defaultDependencies || []).map((d) => d.replace('@billie-coop/', '')),
  );

  const defaultDeps: string[] = [];
  const regularDeps: string[] = [];

  for (const dep of allDeps) {
    if (defaultDepsSet.has(dep)) {
      defaultDeps.push(dep);
    } else {
      regularDeps.push(dep);
    }
  }

  // Sort each group alphabetically, then combine with defaults first
  defaultDeps.sort();
  regularDeps.sort();
  const newDependsOn = [...defaultDeps, ...regularDeps];

  // Check if anything changed
  const currentDependsOn = currentMoonYml.dependsOn || [];
  const changed = JSON.stringify(currentDependsOn) !== JSON.stringify(newDependsOn);

  // Update the dependsOn field
  if (newDependsOn.length > 0) {
    updated.dependsOn = newDependsOn;
  } else {
    // Remove dependsOn if empty
    updated.dependsOn = undefined;
  }

  return { updated, changed };
}

/**
 * Detects stale dependencies by comparing current files with resolved graph
 */
function detectStaleDependencies(
  project: ResolvedProject,
  currentPackageJson: PackageJson,
  currentTsconfig: TsConfig | null,
): StaleDependencies {
  const stale: StaleDependencies = {
    packageJsonDeps: [],
    tsconfigPaths: [],
    tsconfigReferences: [],
  };

  // Get all resolved dependency IDs
  const resolvedDeps = new Set(Object.keys(project.dependencies));

  // Check package.json dependencies
  const allCurrentDeps = {
    ...currentPackageJson.dependencies,
    ...currentPackageJson.devDependencies,
  };

  for (const [depName, version] of Object.entries(allCurrentDeps)) {
    // Only check workspace dependencies
    if (version.includes('workspace:') && depName.startsWith('@billie-coop/')) {
      if (!resolvedDeps.has(depName)) {
        stale.packageJsonDeps.push(depName);
      }
    }
  }

  // Check tsconfig paths
  if (currentTsconfig?.compilerOptions?.paths) {
    for (const pathKey of Object.keys(currentTsconfig.compilerOptions.paths)) {
      // Extract package name from path (e.g., "@billie-coop/ui" or "@billie-coop/ui/*")
      const packageName = pathKey.replace(/\/\*$/, '');

      // Only check workspace packages
      if (packageName.startsWith('@billie-coop/')) {
        // Skip the wildcard entry if we have the base entry
        if (pathKey.endsWith('/*')) {
          const baseName = packageName;
          if (!resolvedDeps.has(baseName) && currentTsconfig.compilerOptions.paths[baseName]) {
            continue; // Will be handled by base entry
          }
        }

        if (!resolvedDeps.has(packageName)) {
          stale.tsconfigPaths.push(pathKey);
        }
      }
    }
  }

  // Check tsconfig references
  if (currentTsconfig?.references) {
    for (const ref of currentTsconfig.references) {
      // Try to match reference path to a resolved dependency
      let isStale = true;

      for (const depId of resolvedDeps) {
        const dep = project.dependencies[depId];
        if (dep) {
          const relativePath = relative(
            dirname(project.project.tsconfigPath || project.project.root),
            dep.dependency.root,
          );
          if (
            ref.path === relativePath ||
            ref.path === `./${relativePath}` ||
            ref.path === `../${dep.dependency.id.replace('@billie-coop/', '')}`
          ) {
            isStale = false;
            break;
          }
        }
      }

      if (isStale) {
        stale.tsconfigReferences.push(ref.path);
      }
    }
  }

  return stale;
}

/**
 * Creates a diff string showing changes
 */
function createDiff(original: string, updated: string, filePath: string): string {
  const originalLines = original.split('\n');
  const updatedLines = updated.split('\n');

  let diff = `--- ${filePath}\n+++ ${filePath} (updated)\n`;

  // Simple line-by-line diff
  const maxLines = Math.max(originalLines.length, updatedLines.length);
  let inChange = false;
  let changeStart = 0;

  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i] || '';
    const newLine = updatedLines[i] || '';

    if (origLine !== newLine) {
      if (!inChange) {
        inChange = true;
        changeStart = Math.max(0, i - 2);
        diff += `@@ -${changeStart + 1},${Math.min(7, originalLines.length - changeStart)} +${changeStart + 1},${Math.min(7, updatedLines.length - changeStart)} @@\n`;

        // Add context lines before
        for (let j = changeStart; j < i; j++) {
          diff += ` ${originalLines[j] || ''}\n`;
        }
      }

      if (i < originalLines.length) {
        diff += `-${origLine}\n`;
      }
      if (i < updatedLines.length) {
        diff += `+${newLine}\n`;
      }
    } else if (inChange) {
      diff += ` ${origLine}\n`;

      // Check if we should end the change block
      let hasMoreChanges = false;
      for (let j = i + 1; j < maxLines && j < i + 3; j++) {
        if ((originalLines[j] || '') !== (updatedLines[j] || '')) {
          hasMoreChanges = true;
          break;
        }
      }

      if (!hasMoreChanges) {
        inChange = false;
      }
    }
  }

  return diff;
}

/**
 * Deep merge two objects, with source values taking precedence
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue === undefined) continue;

    // If both are objects (and not arrays), merge recursively
    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      ) as T[Extract<keyof T, string>];
    } else {
      // Otherwise, source value overwrites
      result[key] = sourceValue as T[Extract<keyof T, string>];
    }
  }

  return result;
}

/**
 * Substitute template variables like {{projectDir}} with actual values
 */
function substituteTemplateVars(template: unknown, vars: Record<string, string>): unknown {
  if (typeof template === 'string') {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  if (Array.isArray(template)) {
    return template.map((item) => substituteTemplateVars(item, vars));
  }

  if (template && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = substituteTemplateVars(value, vars);
    }
    return result;
  }

  return template;
}

/**
 * Updates package.json with resolved dependencies
 * SIMPLE: Merge template, then replace workspace dependencies with what we calculated
 */
function updatePackageJson(
  project: ResolvedProject,
  currentPackageJson: PackageJson,
  _config: SyncConfig,
): { updated: PackageJson; changed: boolean } {
  let updated = JSON.parse(JSON.stringify(currentPackageJson));

  // Apply template if available
  if (project.project.workspaceConfig?.packageJsonTemplate) {
    const template = project.project.workspaceConfig.packageJsonTemplate;

    // Extract project directory name from relativeRoot (e.g., "apps/plantsome-mobile" -> "plantsome-mobile")
    const projectDir = project.project.relativeRoot.split('/').pop() || '';

    // Substitute template variables
    const substituted = substituteTemplateVars(template, { projectDir }) as Partial<PackageJson>;

    // Merge template with current package.json (template values take precedence for non-dependency fields)
    updated = deepMerge(updated, substituted);
  }

  // Build new dependency object from our resolved graph
  const newDeps: Record<string, string> = {};

  // First, preserve non-workspace dependencies
  for (const [name, version] of Object.entries(currentPackageJson.dependencies || {})) {
    if (!version.includes('workspace:')) {
      newDeps[name] = version;
    }
  }

  // Now add all our resolved workspace dependencies
  for (const [depId, _dep] of Object.entries(project.dependencies)) {
    newDeps[depId] = 'workspace:*';
  }

  // Sort alphabetically
  const sortedDeps = Object.keys(newDeps)
    .sort()
    .reduce(
      (obj, key) => {
        obj[key] = newDeps[key]!;
        return obj;
      },
      {} as Record<string, string>,
    );

  // Set the new dependency section (or remove if empty)
  if (Object.keys(sortedDeps).length > 0) {
    updated.dependencies = sortedDeps;
  } else {
    updated.dependencies = undefined;
  }

  // Keep devDependencies as-is (we don't manage them)
  if (currentPackageJson.devDependencies) {
    updated.devDependencies = currentPackageJson.devDependencies;
  }

  // Check if ANYTHING changed (not just dependencies)
  // This ensures template fields (scripts, files, etc.) get enforced unconditionally
  const changed = JSON.stringify(currentPackageJson) !== JSON.stringify(updated);

  return { updated, changed };
}

/**
 * Updates tsconfig.json with resolved dependencies
 * SIMPLE: Merge template, then replace workspace paths and references with what we calculated
 */
function updateTsConfig(
  project: ResolvedProject,
  currentTsconfig: TsConfig | null,
): { updated: TsConfig; changed: boolean } | null {
  if (!currentTsconfig) {
    return null;
  }

  let updated = JSON.parse(JSON.stringify(currentTsconfig));

  // Apply template if available
  if (project.project.workspaceConfig?.tsconfigTemplate) {
    const template = project.project.workspaceConfig.tsconfigTemplate;

    // Extract project directory name from relativeRoot (e.g., "apps/plantsome-mobile" -> "plantsome-mobile")
    const projectDir = project.project.relativeRoot.split('/').pop() || '';

    // Substitute template variables
    const substituted = substituteTemplateVars(template, { projectDir }) as Partial<TsConfig>;

    // Merge template with current tsconfig (template values take precedence for non-path/reference fields)
    updated = deepMerge(updated, substituted);
  }

  // Build new paths object from our resolved graph
  const newPaths: Record<string, string[]> = {};

  // First, preserve non-workspace paths
  for (const [path, targets] of Object.entries(currentTsconfig.compilerOptions?.paths || {})) {
    if (!path.startsWith('@billie-coop/')) {
      newPaths[path] = targets;
    }
  }

  // Now add all our resolved workspace dependencies
  for (const [depId, dep] of Object.entries(project.dependencies)) {
    const depRelativePath = relative(
      dirname(project.project.tsconfigPath || project.project.root),
      dep.dependency.root,
    ).replace(/\\/g, '/');

    // Base path mapping
    newPaths[depId] = [join(depRelativePath, dep.entryPoint.path).replace(/\\/g, '/')];

    // Wildcard path mapping for deep imports
    // Use src/* if the entry point is in src/ directory
    const wildcardPath = dep.entryPoint.path.startsWith('src/')
      ? `${depRelativePath}/src/*`
      : `${depRelativePath}/*`;
    newPaths[`${depId}/*`] = [wildcardPath.replace(/\\/g, '/')];
  }

  // Sort paths alphabetically, but keep base/wildcard pairs together
  // First, group the paths by their base package name
  const pathGroups: Map<string, string[]> = new Map();

  for (const path of Object.keys(newPaths)) {
    const baseName = path.replace(/\/\*$/, '');
    if (!pathGroups.has(baseName)) {
      pathGroups.set(baseName, []);
    }
    const group = pathGroups.get(baseName);
    if (group) {
      group.push(path);
    }
  }

  // Sort the groups alphabetically, then build the final paths object
  const sortedPaths: Record<string, string[]> = {};
  const sortedGroups = Array.from(pathGroups.keys()).sort();

  for (const baseName of sortedGroups) {
    const paths = pathGroups.get(baseName);
    if (paths) {
      // Sort within group: base first, then wildcard
      paths.sort((a, b) => {
        if (a === baseName) return -1;
        if (b === baseName) return 1;
        return a.localeCompare(b);
      });

      for (const path of paths) {
        const pathValue = newPaths[path];
        if (pathValue !== undefined) {
          sortedPaths[path] = pathValue;
        }
      }
    }
  }

  // Build new references array from our resolved graph
  const newReferences: Array<{ path: string }> = [];
  for (const [_depId, dep] of Object.entries(project.dependencies)) {
    const depRelativePath = relative(
      dirname(project.project.tsconfigPath || project.project.root),
      dep.dependency.root,
    ).replace(/\\/g, '/');

    newReferences.push({ path: depRelativePath });
  }

  // Sort references for consistency
  newReferences.sort((a, b) => a.path.localeCompare(b.path));

  // Set the new paths and references
  if (!updated.compilerOptions) updated.compilerOptions = {};

  if (Object.keys(sortedPaths).length > 0) {
    updated.compilerOptions.paths = sortedPaths;
  } else {
    updated.compilerOptions.paths = undefined;
  }

  if (newReferences.length > 0 || currentTsconfig.references) {
    updated.references = newReferences;
  }

  // Check if ANYTHING changed (not just paths/references)
  // This ensures template fields (extends, include, compilerOptions.outDir, etc.) get enforced unconditionally
  const changed = JSON.stringify(currentTsconfig) !== JSON.stringify(updated);

  return { updated, changed };
}

/**
 * Emits changes to package.json and tsconfig.json files
 */
export async function emitChanges(
  graph: ResolvedGraph,
  config: SyncConfig,
  options: { dryRun?: boolean; verbose?: boolean } = {},
): Promise<EmitResult> {
  const { dryRun = false, verbose = false } = options;

  const result: EmitResult = {
    filesModified: 0,
    projectsUpdated: [],
    staleDependencies: {},
    diffs: dryRun ? {} : undefined,
    warnings: [],
  };

  log.step('Analyzing changes needed...');

  for (const [projectId, project] of Object.entries(graph.projects)) {
    if (verbose) {
      log.debug(`Processing ${projectId}...`);
    }

    const packageJsonPath = join(project.project.root, 'package.json');
    const tsconfigPath = project.project.tsconfigPath;
    const moonYmlPath = join(project.project.root, 'moon.yml');

    // Read current files
    let currentPackageJson: PackageJson;
    try {
      currentPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    } catch (error) {
      result.warnings.push(`Failed to read package.json for ${projectId}: ${error}`);
      continue;
    }

    let currentTsconfig: TsConfig | null = null;
    if (tsconfigPath && existsSync(tsconfigPath)) {
      try {
        currentTsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      } catch (error) {
        result.warnings.push(`Failed to read tsconfig.json for ${projectId}: ${error}`);
      }
    }

    // Read moon.yml if it exists (temporary - will be removed once fully transitioned to new tooling)
    let currentMoonYml: MoonYml | null = null;
    if (existsSync(moonYmlPath)) {
      try {
        // Read as string first, then parse as YAML-like format
        const moonContent = readFileSync(moonYmlPath, 'utf-8');
        // Simple YAML parsing for our needs
        currentMoonYml = parseMoonYml(moonContent);
      } catch (error) {
        result.warnings.push(`Failed to read moon.yml for ${projectId}: ${error}`);
      }
    }

    // Detect stale dependencies
    const staleDeps = detectStaleDependencies(project, currentPackageJson, currentTsconfig);

    // LOG THE ACTUAL STATE VS CURRENT STATE
    const importedDeps = Object.keys(project.dependencies).sort();
    const reportedDeps = Object.keys(currentPackageJson.dependencies || {})
      .filter((k) => k.startsWith('@billie-coop/'))
      .sort();

    // Show the truth vs current state
    const toAdd = importedDeps.filter((d) => !reportedDeps.includes(d));
    const toRemove = reportedDeps.filter((d) => !importedDeps.includes(d));

    if (toAdd.length > 0 || toRemove.length > 0) {
      log.info(`\n📦 ${projectId}:`);
      log.info(`  IMPORTED (truth): ${importedDeps.length > 0 ? importedDeps.join(', ') : 'NONE'}`);
      log.info(
        `  REPORTED (current): ${reportedDeps.length > 0 ? reportedDeps.join(', ') : 'NONE'}`,
      );

      if (toAdd.length > 0) log.info(`  ➕ TO ADD: ${toAdd.join(', ')}`);
      if (toRemove.length > 0) log.info(`  ➖ TO REMOVE: ${toRemove.join(', ')}`);
    }

    // Track stale dependencies
    if (
      staleDeps.packageJsonDeps.length > 0 ||
      staleDeps.tsconfigPaths.length > 0 ||
      staleDeps.tsconfigReferences.length > 0
    ) {
      result.staleDependencies[projectId] = staleDeps;

      if (verbose) {
        if (staleDeps.packageJsonDeps.length > 0) {
          log.debug(`  Stale package.json deps: ${staleDeps.packageJsonDeps.join(', ')}`);
        }
        if (staleDeps.tsconfigPaths.length > 0) {
          log.debug(`  Stale tsconfig paths: ${staleDeps.tsconfigPaths.join(', ')}`);
        }
      }
    }

    // Update package.json
    const { updated: updatedPackageJson, changed: packageJsonChanged } = updatePackageJson(
      project,
      currentPackageJson,
      config,
    );

    // Update tsconfig.json
    const tsconfigResult = currentTsconfig ? updateTsConfig(project, currentTsconfig) : null;

    // Update moon.yml (temporary - will be removed once fully transitioned to new tooling)
    const moonYmlResult = currentMoonYml ? updateMoonYml(project, currentMoonYml, config) : null;

    // Track changes
    let projectModified = false;

    if (packageJsonChanged) {
      if (verbose) {
        log.debug(`  package.json changes detected for ${projectId}`);
      }
      const originalContent = JSON.stringify(currentPackageJson, null, 2);
      const updatedContent = JSON.stringify(updatedPackageJson, null, 2);

      if (dryRun) {
        if (result.diffs) {
          result.diffs[packageJsonPath] = createDiff(
            originalContent,
            updatedContent,
            packageJsonPath,
          );
        }
      } else {
        writeFileSync(packageJsonPath, `${updatedContent}\n`);
      }

      result.filesModified++;
      projectModified = true;

      if (verbose) {
        log.debug(`  Updated package.json`);
      }
    }

    if (tsconfigResult?.changed && tsconfigPath) {
      if (verbose) {
        log.debug(`  tsconfig.json changes detected for ${projectId}`);
      }
      const originalContent = JSON.stringify(currentTsconfig, null, 2);
      const updatedContent = JSON.stringify(tsconfigResult.updated, null, 2);

      if (dryRun) {
        if (result.diffs) {
          result.diffs[tsconfigPath] = createDiff(originalContent, updatedContent, tsconfigPath);
        }
      } else {
        writeFileSync(tsconfigPath, `${updatedContent}\n`);
      }

      result.filesModified++;
      projectModified = true;

      if (verbose) {
        log.debug(`  Updated tsconfig.json`);
      }
    }

    // Update moon.yml if it exists and changed (temporary - will be removed once fully transitioned to new tooling)
    if (moonYmlResult?.changed && currentMoonYml) {
      if (verbose) {
        log.debug(`  moon.yml changes detected for ${projectId}`);
      }
      const originalContent = formatMoonYml(currentMoonYml);
      const updatedContent = formatMoonYml(moonYmlResult.updated);

      if (dryRun) {
        if (result.diffs) {
          result.diffs[moonYmlPath] = createDiff(originalContent, updatedContent, moonYmlPath);
        }
      } else {
        writeFileSync(moonYmlPath, updatedContent);
      }

      result.filesModified++;
      projectModified = true;

      if (verbose) {
        log.debug(`  Updated moon.yml`);
      }
    }

    if (projectModified) {
      result.projectsUpdated.push(projectId);
    }
  }

  // Report summary
  if (Object.keys(result.staleDependencies).length > 0) {
    const totalStale = Object.values(result.staleDependencies).reduce(
      (sum, stale) =>
        sum +
        stale.packageJsonDeps.length +
        stale.tsconfigPaths.length +
        stale.tsconfigReferences.length,
      0,
    );

    log.warn(
      `Found ${totalStale} stale dependencies across ${Object.keys(result.staleDependencies).length} projects`,
    );

    if (verbose) {
      for (const [projectId, stale] of Object.entries(result.staleDependencies)) {
        if (stale?.packageJsonDeps?.length > 0) {
          log.debug(`  ${projectId}: ${stale.packageJsonDeps.join(', ')}`);
        }
      }
    }
  }

  if (result.filesModified > 0) {
    log.success(
      `Will modify ${result.filesModified} files across ${result.projectsUpdated.length} projects`,
    );
  } else {
    log.success('All dependencies are already in sync!');
  }

  // Show summary in dry-run mode
  if (dryRun && result.projectsUpdated.length > 0) {
    log.section('Proposed Changes Summary');

    // Group projects by change type
    const projectsWithStale = Object.keys(result.staleDependencies);
    const projectsWithAdditions = result.projectsUpdated.filter(
      (p) => !projectsWithStale.includes(p),
    );

    if (projectsWithStale.length > 0) {
      log.warn(`\n📦 Projects with stale dependencies to remove (${projectsWithStale.length}):`);

      for (const projectId of projectsWithStale.slice(0, verbose ? 100 : 5)) {
        const stale = result.staleDependencies[projectId];
        const project = graph.projects[projectId];

        log.info(`\n  ${projectId}:`);

        if (stale && stale.packageJsonDeps.length > 0) {
          log.info(`    ❌ Remove: ${stale.packageJsonDeps.join(', ')}`);
        }

        if (project) {
          const deps = Object.keys(project.dependencies);
          if (deps.length > 0) {
            log.info(
              `    ✅ Keep/Add: ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? ` + ${deps.length - 10} more` : ''}`,
            );
          }
        }
      }

      if (projectsWithStale.length > 5 && !verbose) {
        log.info(`\n  ... and ${projectsWithStale.length - 5} more projects with stale deps`);
      }
    }

    if (projectsWithAdditions.length > 0) {
      log.info(`\n📦 Projects getting dependency updates (${projectsWithAdditions.length}):`);

      for (const projectId of projectsWithAdditions.slice(0, verbose ? 100 : 5)) {
        const project = graph.projects[projectId];
        if (project) {
          const deps = Object.keys(project.dependencies);
          log.info(`\n  ${projectId}:`);
          log.info(
            `    ➕ Dependencies: ${deps.slice(0, 8).join(', ')}${deps.length > 8 ? ` + ${deps.length - 8} more` : ''}`,
          );
        }
      }

      if (projectsWithAdditions.length > 5 && !verbose) {
        log.info(`\n  ... and ${projectsWithAdditions.length - 5} more projects`);
      }
    }

    // Show aggregated statistics
    log.section('Change Statistics');

    const totalDepsToAdd = Object.values(graph.projects).reduce(
      (sum, p) => sum + Object.keys(p.dependencies).length,
      0,
    );

    const totalStaleToRemove = Object.values(result.staleDependencies).reduce(
      (sum, stale) => sum + stale.packageJsonDeps.length,
      0,
    );

    log.info(`📊 Total changes:`);
    log.info(`   • Dependencies to manage: ${totalDepsToAdd}`);
    log.info(`   • Stale dependencies to remove: ${totalStaleToRemove}`);
    log.info(`   • Files to update: ${result.filesModified}`);
    log.info(
      `   • Projects affected: ${result.projectsUpdated.length} / ${Object.keys(graph.projects).length}`,
    );

    // Show most common dependencies being added
    const depCounts: Record<string, number> = {};
    for (const project of Object.values(graph.projects)) {
      for (const depId of Object.keys(project.dependencies)) {
        depCounts[depId] = (depCounts[depId] || 0) + 1;
      }
    }

    const topDeps = Object.entries(depCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topDeps.length > 0) {
      log.info(`\n🔝 Most common dependencies:`);
      for (const [dep, count] of topDeps) {
        log.info(`   • ${dep}: used by ${count} projects`);
      }
    }
  }

  return result;
}
