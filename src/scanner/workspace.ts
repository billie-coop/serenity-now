// Workspace discovery for the sync-deps tool
// Phase 1: Discovers all projects in the monorepo
// Deno version using built-in APIs

import { join, relative } from "@std/path";
import { expandGlob } from "@std/fs";
import { exists } from "@std/fs/exists";
import { log } from "../utils/logging.ts";
import { tryReadJson } from "../utils/files.ts";
import type {
  PackageJson,
  ProjectInfo,
  ProjectInventory,
  SyncConfig,
  WorkspaceSubType,
  WorkspaceTypeConfig,
} from "../core/types.ts";

/**
 * Discovers workspace patterns from package.json workspaces field
 */
async function discoverWorkspacePatterns(rootDir: string): Promise<string[]> {
  const packageJsonPath = join(rootDir, "package.json");
  const rootPackageJson = await tryReadJson<PackageJson>(packageJsonPath, {});

  // Get workspace patterns from package.json
  const workspaceField = rootPackageJson.workspaces;
  if (!workspaceField) {
    return [];
  }

  // Handle both array and object formats
  const patterns = Array.isArray(workspaceField)
    ? workspaceField
    : workspaceField.packages || [];

  // Filter out negative patterns
  return patterns.filter((p) => !p.startsWith("!"));
}

/**
 * Find all projects matching workspace patterns
 */
async function findProjects(
  rootDir: string,
  patterns: string[],
  verbose: boolean,
): Promise<Map<string, string>> {
  const projects = new Map<string, string>();

  for (const pattern of patterns) {
    const searchPattern = pattern.endsWith("/*") ? pattern : `${pattern}/*`;
    const globPattern = join(rootDir, searchPattern, "package.json");

    if (verbose) {
      log.debug(`  Searching: ${searchPattern}`);
    }

    for await (const entry of expandGlob(globPattern, { root: rootDir })) {
      if (entry.isFile && entry.name === "package.json") {
        const projectDir = entry.path.replace(/\/package\.json$/, "");
        const projectPath = relative(rootDir, projectDir);

        if (projectPath && !projectPath.startsWith("..")) {
          const packageJson = await tryReadJson<PackageJson>(entry.path, {});
          if (packageJson.name) {
            projects.set(packageJson.name, projectDir);
            if (verbose) {
              log.debug(`    Found: ${packageJson.name} at ${projectPath}`);
            }
          }
        }
      }
    }
  }

  return projects;
}

/**
 * Determines workspace type configuration for a project
 */
function determineWorkspaceType(
  relativeRoot: string,
  config: SyncConfig,
): {
  workspaceType: "app" | "shared-package" | "unknown";
  workspaceSubType: WorkspaceSubType;
  workspaceConfig?: WorkspaceTypeConfig;
} {
  // Check configured patterns
  if (config.workspaceTypes) {
    for (const [pattern, typeConfig] of Object.entries(config.workspaceTypes)) {
      const regex = new RegExp(
        `^${pattern.replace(/\*/g, "[^/]+")}$`,
      );
      if (regex.test(relativeRoot)) {
        const subType = typeConfig.subType ||
          inferWorkspaceSubType(relativeRoot);
        return {
          workspaceType: typeConfig.type,
          workspaceSubType: subType,
          workspaceConfig: typeConfig,
        };
      }
    }
  }

  // Fallback to guessing based on common patterns
  const workspaceType = relativeRoot.startsWith("apps/") ||
      relativeRoot.startsWith("websites/") ||
      relativeRoot === "app"
    ? "app"
    : relativeRoot.startsWith("packages/") || relativeRoot === "packages"
    ? "shared-package"
    : "unknown";

  return {
    workspaceType,
    workspaceSubType: inferWorkspaceSubType(relativeRoot),
  };
}

/**
 * Infers workspace sub-type from the project path
 */
function inferWorkspaceSubType(relativeRoot: string): WorkspaceSubType {
  const parts = relativeRoot.toLowerCase();

  if (
    parts.includes("mobile") || parts.includes("ios") ||
    parts.includes("android")
  ) {
    return "mobile";
  }
  if (parts.includes("db") || parts.includes("database")) {
    return "db";
  }
  if (parts.includes("marketing")) {
    return "marketing";
  }
  if (parts.includes("plugin")) {
    return "plugin";
  }
  if (parts.includes("ui") || parts.includes("component")) {
    return "ui";
  }
  if (parts.includes("website") || parts.includes("site")) {
    return "website";
  }
  if (
    parts.includes("lib") || parts.includes("util") || parts.includes("helper")
  ) {
    return "library";
  }

  return "unknown";
}

/**
 * Validates package name against workspace configuration
 */
function validatePackageName(
  name: string,
  relativeRoot: string,
  workspaceConfig?: WorkspaceTypeConfig,
): string[] {
  const warnings: string[] = [];

  if (!workspaceConfig?.enforceNamePrefix) {
    return warnings;
  }

  const prefix = workspaceConfig.enforceNamePrefix;
  if (!name.startsWith(prefix)) {
    warnings.push(
      `Package ${name} at ${relativeRoot} should start with "${prefix}" based on workspace configuration`,
    );
  }

  return warnings;
}

// Define minimal interface to avoid circular import
interface ManagerLike {
  root: string;
  isVerbose(): boolean;
}

/**
 * Discovers all projects in the workspace
 */
export async function discoverWorkspace(
  manager: ManagerLike,
  config: SyncConfig,
): Promise<ProjectInventory> {
  const rootDir = manager.root;
  const verbose = manager.isVerbose();

  log.step("Discovering workspace projects...");

  // Check if we're in a monorepo
  const rootPackageJsonPath = join(rootDir, "package.json");
  if (!await exists(rootPackageJsonPath, { isFile: true })) {
    throw new Error("No package.json found in root directory");
  }

  // Discover workspace patterns
  const patterns = await discoverWorkspacePatterns(rootDir);
  if (patterns.length === 0) {
    log.warn("No workspace configuration found in package.json");
    return { projects: {}, warnings: [], workspaceConfigs: {} };
  }

  if (verbose) {
    log.debug(`Workspace patterns: ${patterns.join(", ")}`);
  }

  // Find all projects
  const projectPaths = await findProjects(rootDir, patterns, verbose);

  // Build project inventory
  const projects: Record<string, ProjectInfo> = {};
  const warnings: string[] = [];
  const workspaceConfigs: Record<string, WorkspaceTypeConfig> = {};

  for (const [packageName, projectRoot] of projectPaths.entries()) {
    const relativeRoot = relative(rootDir, projectRoot);
    const packageJsonPath = join(projectRoot, "package.json");

    const packageJson = await tryReadJson<PackageJson>(packageJsonPath, {});

    // Find tsconfig.json
    let tsconfigPath: string | undefined;
    const tsconfigCandidates = [
      join(projectRoot, "tsconfig.json"),
      join(projectRoot, "tsconfig.build.json"),
    ];

    for (const candidate of tsconfigCandidates) {
      if (await exists(candidate, { isFile: true })) {
        tsconfigPath = candidate;
        break;
      }
    }

    // Determine workspace type
    const { workspaceType, workspaceSubType, workspaceConfig } =
      determineWorkspaceType(
        relativeRoot,
        config,
      );

    // Track workspace configs for reference
    if (workspaceConfig) {
      workspaceConfigs[relativeRoot] = workspaceConfig;
    }

    // Validate package name
    const nameWarnings = validatePackageName(
      packageName,
      relativeRoot,
      workspaceConfig,
    );
    warnings.push(...nameWarnings);

    projects[packageName] = {
      id: packageName,
      root: projectRoot,
      relativeRoot,
      packageJson,
      tsconfigPath,
      workspaceType,
      workspaceSubType,
      workspaceConfig,
      isPrivate: packageJson.private ?? false,
    };
  }

  log.success(`Found ${Object.keys(projects).length} workspace projects`);

  if (warnings.length > 0) {
    log.warn(`${warnings.length} warnings during workspace discovery`);
    if (verbose) {
      for (const w of warnings) {
        log.debug(`  ${w}`);
      }
    }
  }

  return { projects, warnings, workspaceConfigs };
}
