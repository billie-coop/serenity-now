// Import scanning and analysis for the sync-deps tool
// Phase 2: Scans TypeScript/JavaScript files to track workspace package usage
// Deno version using built-in APIs

import { globToRegExp, join, relative } from "@std/path";
import { expandGlob } from "@std/fs";
import { log } from "../utils/logging.ts";
import type {
  ProjectInventory,
  ProjectUsage,
  ProjectUsageRecord,
  SyncConfig,
  UsageRecord,
} from "../core/types.ts";

// File extensions to scan for imports
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// Default patterns to exclude from scanning
const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.turbo/**",
  "**/.moon/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/generated/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
];

/**
 * Gets exclude patterns from config or uses defaults
 */
function getExcludePatterns(config: SyncConfig): string[] {
  return config.excludePatterns || DEFAULT_EXCLUDE_PATTERNS;
}

// Regular expressions for parsing imports
const IMPORT_PATTERNS = {
  // Static imports: import ... from 'module.js'
  staticImport:
    /^import\s+(?:type\s+)?(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+))(?:\s*,\s*(?:\*\s+as\s+\w+|\{[^}]*\}|\w+))*\s+from\s+['"]([^'"]+)['"]/gm,

  // Type-only imports: import type { ... } from 'module.js'
  typeImport:
    /^import\s+type\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+))(?:\s*,\s*(?:\*\s+as\s+\w+|\{[^}]*\}|\w+))*\s+from\s+['"]([^'"]+)['"]/gm,

  // Dynamic imports: import('module')
  dynamicImport: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,

  // Require statements: require('module')
  require: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,

  // Export from: export ... from 'module.js'
  exportFrom:
    /^export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm,

  // Type-only export from: export type ... from 'module.js'
  typeExportFrom:
    /^export\s+type\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm,
};

/**
 * Checks if a file should be excluded
 */
function shouldExclude(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const pattern of patterns) {
    // Use Deno's standard library for glob-to-regex conversion
    const regex = globToRegExp(pattern, { extended: true, globstar: true });

    if (regex.test(normalizedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Finds all source files in a project
 */
async function findSourceFiles(
  projectRoot: string,
  excludePatterns: string[],
  verbose: boolean,
): Promise<string[]> {
  const files: string[] = [];

  try {
    for (const ext of SOURCE_EXTENSIONS) {
      const pattern = join(projectRoot, "**", `*${ext}`);

      for await (const entry of expandGlob(pattern, { root: projectRoot })) {
        if (entry.isFile) {
          const relativePath = relative(projectRoot, entry.path);

          if (!shouldExclude(relativePath, excludePatterns)) {
            files.push(relativePath);
          }
        }
      }
    }

    if (verbose && files.length > 0) {
      log.debug(
        `Found ${files.length} source files in ${
          relative(Deno.cwd(), projectRoot)
        }`,
      );
    }

    return files;
  } catch (error) {
    log.warn(`Failed to scan files in ${projectRoot}: ${error}`);
    return [];
  }
}

/**
 * Parses a source file and extracts all imports
 */
function parseFileImports(
  filePath: string,
  content: string,
  verbose: boolean,
): UsageRecord[] {
  const records: UsageRecord[] = [];
  const seenSpecifiers = new Set<string>();

  // Helper to add unique records
  const addRecord = (specifier: string, isTypeOnly: boolean) => {
    // Skip relative imports
    if (specifier.startsWith(".")) {
      return;
    }

    // Create a unique key for deduplication
    const key = `${specifier}:${isTypeOnly}`;
    if (!seenSpecifiers.has(key)) {
      seenSpecifiers.add(key);
      records.push({
        dependencyId: "", // Will be filled later
        specifier,
        isTypeOnly,
        sourceFile: filePath,
      });
    }
  };

  // Parse type-only imports first (they override regular imports)
  const typeOnlySpecifiers = new Set<string>();

  // Type imports
  const typeImportMatches = content.matchAll(IMPORT_PATTERNS.typeImport);
  for (const match of typeImportMatches) {
    const specifier = match[1];
    if (specifier) {
      typeOnlySpecifiers.add(specifier);
      addRecord(specifier, true);
    }
  }

  // Type-only export from
  const typeExportMatches = content.matchAll(IMPORT_PATTERNS.typeExportFrom);
  for (const match of typeExportMatches) {
    const specifier = match[1];
    if (specifier) {
      typeOnlySpecifiers.add(specifier);
      addRecord(specifier, true);
    }
  }

  // Parse regular imports (skip if already marked as type-only)

  // Static imports
  const staticMatches = content.matchAll(IMPORT_PATTERNS.staticImport);
  for (const match of staticMatches) {
    const specifier = match[1];
    if (specifier && !typeOnlySpecifiers.has(specifier)) {
      addRecord(specifier, false);
    }
  }

  // Export from
  const exportMatches = content.matchAll(IMPORT_PATTERNS.exportFrom);
  for (const match of exportMatches) {
    const specifier = match[1];
    if (specifier && !typeOnlySpecifiers.has(specifier)) {
      addRecord(specifier, false);
    }
  }

  // Dynamic imports (always runtime)
  const dynamicMatches = content.matchAll(IMPORT_PATTERNS.dynamicImport);
  for (const match of dynamicMatches) {
    const specifier = match[1];
    if (specifier) {
      addRecord(specifier, false);
    }
  }

  // Require statements (always runtime)
  const requireMatches = content.matchAll(IMPORT_PATTERNS.require);
  for (const match of requireMatches) {
    const specifier = match[1];
    if (specifier) {
      addRecord(specifier, false);
    }
  }

  if (verbose && records.length > 0) {
    log.debug(`  Found ${records.length} imports in ${filePath}`);
  }

  return records;
}

/**
 * Resolves an import specifier to a workspace package name
 */
function resolveWorkspacePackage(
  specifier: string,
  workspacePackages: Set<string>,
  config: SyncConfig,
): string | null {
  // Check if import should be ignored
  if (
    config.ignoreImports?.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
        return regex.test(specifier);
      }
      return specifier === pattern || specifier.startsWith(`${pattern}/`);
    })
  ) {
    return null;
  }

  // Direct package import: @billie-coop/ui
  if (workspacePackages.has(specifier)) {
    return specifier;
  }

  // Subpath import: @billie-coop/ui/components
  // Find the package that matches the start of the specifier
  for (const pkg of workspacePackages) {
    if (specifier === pkg || specifier.startsWith(`${pkg}/`)) {
      return pkg;
    }
  }

  return null;
}

/**
 * Scans all projects for imports and builds usage map
 */
export async function scanProjectImports(
  inventory: ProjectInventory,
  config: SyncConfig,
  options: { verbose?: boolean } = {},
): Promise<ProjectUsage> {
  const { verbose = false } = options;
  const warnings: string[] = [];
  const usage: Record<string, ProjectUsageRecord> = {};

  // Get all workspace package names for lookup
  const workspacePackageNames = Object.keys(inventory.projects);
  const workspacePackages = new Set(workspacePackageNames); // Keep as Set for efficient lookup

  log.step("Scanning imports in all projects...");

  const excludePatterns = getExcludePatterns(config);
  let totalFiles = 0;
  let totalImports = 0;

  for (const [projectId, project] of Object.entries(inventory.projects)) {
    if (verbose) {
      log.info(`Scanning ${projectId}...`);
    }

    // Skip if project should be ignored
    if (config.ignoreProjects?.includes(projectId)) {
      if (verbose) {
        log.debug(`  Skipping ignored project`);
      }
      continue;
    }

    // Find all source files in the project
    const sourceFiles = await findSourceFiles(
      project.root,
      excludePatterns,
      verbose,
    );
    totalFiles += sourceFiles.length;

    // Parse imports from each file
    const projectUsage: ProjectUsageRecord = {
      dependencies: [],
      typeOnlyDependencies: [],
      usageDetails: [],
    };

    for (const file of sourceFiles) {
      const filePath = join(project.root, file);

      try {
        const content = await Deno.readTextFile(filePath);
        const imports = parseFileImports(file, content, verbose);

        // Resolve each import to a workspace package
        for (const importRecord of imports) {
          const packageName = resolveWorkspacePackage(
            importRecord.specifier,
            workspacePackages,
            config,
          );

          if (packageName) {
            // Don't allow self-imports
            if (packageName === projectId) {
              continue;
            }

            // Update the import record with resolved package
            importRecord.dependencyId = packageName;
            projectUsage.usageDetails.push(importRecord);

            // Track in appropriate array (avoid duplicates)
            if (importRecord.isTypeOnly) {
              if (!projectUsage.typeOnlyDependencies.includes(packageName)) {
                projectUsage.typeOnlyDependencies.push(packageName);
              }
            } else {
              if (!projectUsage.dependencies.includes(packageName)) {
                projectUsage.dependencies.push(packageName);
              }
            }

            totalImports++;
          }
        }
      } catch (error) {
        warnings.push(`Failed to parse ${filePath}: ${error}`);
      }
    }

    // Only add to usage map if project has dependencies
    if (
      projectUsage.dependencies.length > 0 ||
      projectUsage.typeOnlyDependencies.length > 0
    ) {
      usage[projectId] = projectUsage;

      if (verbose) {
        const runtime = projectUsage.dependencies.length;
        const typeOnly = projectUsage.typeOnlyDependencies.length;
        log.debug(
          `  Found ${runtime} runtime deps, ${typeOnly} type-only deps`,
        );
      }
    }
  }

  log.success(
    `Scanned ${totalFiles} files, found ${totalImports} workspace imports ` +
      `across ${Object.keys(usage).length} projects`,
  );

  if (warnings.length > 0) {
    log.warn(`${warnings.length} warnings during import scanning`);
    if (verbose) {
      for (const w of warnings) {
        log.debug(`  ${w}`);
      }
    }
  }

  return { usage, warnings };
}

/**
 * Analyzes import usage and generates statistics
 */
export function analyzeImportUsage(
  projectUsage: ProjectUsage,
  inventory: ProjectInventory,
  verbose: boolean,
): void {
  const { usage } = projectUsage;

  if (!verbose) {
    return;
  }

  log.section("Import Analysis");

  // Calculate statistics
  const stats = {
    totalProjects: Object.keys(usage).length,
    totalDependencies: 0,
    totalTypeOnlyDependencies: 0,
    mostUsedPackages: {} as Record<string, number>,
    unusedPackages: new Set(Object.keys(inventory.projects)),
  };

  // Process each project's usage
  for (const [projectId, record] of Object.entries(usage)) {
    stats.totalDependencies += record.dependencies.length;
    stats.totalTypeOnlyDependencies += record.typeOnlyDependencies.length;

    // Track package usage counts
    for (
      const dep of [...record.dependencies, ...record.typeOnlyDependencies]
    ) {
      stats.mostUsedPackages[dep] = (stats.mostUsedPackages[dep] || 0) + 1;
      stats.unusedPackages.delete(dep);
    }

    // Remove the project itself from unused (can't use itself)
    stats.unusedPackages.delete(projectId);
  }

  // Report statistics
  log.info("Import Statistics:");
  log.info(`  - Projects with imports: ${stats.totalProjects}`);
  log.info(`  - Total runtime dependencies: ${stats.totalDependencies}`);
  log.info(
    `  - Total type-only dependencies: ${stats.totalTypeOnlyDependencies}`,
  );

  // Show most used packages
  const sortedPackages = Object.entries(stats.mostUsedPackages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sortedPackages.length > 0) {
    log.info("  - Most used packages:");
    for (const [pkg, count] of sortedPackages) {
      log.info(`      ${pkg}: used by ${count} projects`);
    }
  }

  // Show unused packages (potential for cleanup)
  if (stats.unusedPackages.size > 0) {
    log.info(`  - Potentially unused packages: ${stats.unusedPackages.size}`);
    if (verbose) {
      for (const pkg of stats.unusedPackages) {
        const project = inventory.projects[pkg];
        if (project && project.workspaceType === "shared-package") {
          log.debug(`      ${pkg}`);
        }
      }
    }
  }
}
