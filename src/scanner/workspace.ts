// Phase 1: Workspace discovery

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RepoManager } from '../core/manager';
import type {
  PackageJson,
  ProjectInfo,
  ProjectInventory,
  SyncConfig,
  WorkspaceSubType,
  WorkspaceTypeConfig,
} from '../core/types';
import { fileExists, getRelativePath, readPackageJson } from '../utils/files';

export async function discoverWorkspaceProjects(
  manager: RepoManager,
  config: SyncConfig,
): Promise<ProjectInventory> {
  const logger = manager.getLogger();
  const inventory: ProjectInventory = {
    projects: {},
    warnings: [],
    workspaceConfigs: config.workspaceTypes || {},
  };

  // Read root package.json
  const rootPackageJson = await readPackageJson(manager.root);
  if (!rootPackageJson) {
    throw new Error('No package.json found in root directory');
  }

  // Get workspace patterns
  const workspacePatterns = getWorkspacePatterns(rootPackageJson);
  if (workspacePatterns.length === 0) {
    logger.warn('No workspace patterns found in root package.json');
    return inventory;
  }

  logger.step(`Scanning workspace patterns: ${workspacePatterns.join(', ')}`);

  // Find all package.json files matching workspace patterns
  const packageJsonPaths = await findWorkspacePackages(manager.root, workspacePatterns);

  logger.debug(`Found ${packageJsonPaths.length} potential projects`);

  // Process each project
  for (const pkgPath of packageJsonPaths) {
    const projectRoot = path.dirname(pkgPath);
    const relativeRoot = getRelativePath(manager.root, projectRoot);

    const packageJson = await readPackageJson(projectRoot);
    if (!packageJson || !packageJson.name) {
      logger.warn(`Skipping ${relativeRoot} - no name in package.json`);
      continue;
    }

    // Check for tsconfig.json
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    const hasTsconfig = await fileExists(tsconfigPath);

    // Determine workspace type and config
    const { workspaceType, workspaceSubType, workspaceConfig } = determineWorkspaceType(
      relativeRoot,
      packageJson,
      inventory.workspaceConfigs,
    );

    // Create ProjectInfo
    const projectInfo: ProjectInfo = {
      id: packageJson.name,
      root: projectRoot,
      relativeRoot,
      packageJson,
      tsconfigPath: hasTsconfig ? tsconfigPath : undefined,
      workspaceType,
      workspaceSubType,
      workspaceConfig,
      isPrivate: packageJson.private ?? false,
    };

    // Validate name prefix based on workspace-specific config
    if (workspaceConfig?.enforceNamePrefix) {
      if (
        typeof workspaceConfig.enforceNamePrefix === 'string' &&
        !projectInfo.id.startsWith(workspaceConfig.enforceNamePrefix)
      ) {
        inventory.warnings.push(
          `Project ${projectInfo.id} doesn't match required prefix ${workspaceConfig.enforceNamePrefix} for ${workspaceType} workspace`,
        );
      }
    }

    // Skip ignored projects
    if (config.ignoreProjects?.includes(projectInfo.id)) {
      logger.debug(`Skipping ignored project: ${projectInfo.id}`);
      continue;
    }

    inventory.projects[projectInfo.id] = projectInfo;
    logger.debug(
      `Discovered project: ${projectInfo.id} (${projectInfo.workspaceType}/${projectInfo.workspaceSubType})`,
    );
  }

  logger.step(`Found ${Object.keys(inventory.projects).length} projects`);

  return inventory;
}

function getWorkspacePatterns(packageJson: PackageJson): string[] {
  const patterns: string[] = [];

  if (packageJson.workspaces) {
    if (Array.isArray(packageJson.workspaces)) {
      patterns.push(...packageJson.workspaces);
    } else if (packageJson.workspaces.packages) {
      patterns.push(...packageJson.workspaces.packages);
    }
  }

  return patterns;
}

async function findWorkspacePackages(rootDir: string, patterns: string[]): Promise<string[]> {
  const packageJsonPaths: string[] = [];

  for (const pattern of patterns) {
    // Simple pattern handling for common workspace patterns
    const searchPath = path.join(rootDir, pattern);

    if (pattern.includes('*')) {
      // Handle patterns like "apps/*" or "packages/*"
      const baseDir = pattern.replace(/\/?\*$/, '');
      const dirPath = path.join(rootDir, baseDir);

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'node_modules') {
            const pkgJsonPath = path.join(dirPath, entry.name, 'package.json');
            if (await fileExists(pkgJsonPath)) {
              packageJsonPaths.push(pkgJsonPath);
            }
          }
        }
      } catch (_err) {
        // Directory doesn't exist, skip
      }
    } else {
      // Direct path to a package
      const pkgJsonPath = path.join(searchPath, 'package.json');
      if (await fileExists(pkgJsonPath)) {
        packageJsonPaths.push(pkgJsonPath);
      }
    }
  }

  return packageJsonPaths;
}

function determineWorkspaceType(
  relativeRoot: string,
  packageJson: PackageJson,
  workspaceConfigs: Record<string, WorkspaceTypeConfig>,
): {
  workspaceType: 'app' | 'shared-package' | 'unknown';
  workspaceSubType: WorkspaceSubType;
  workspaceConfig?: WorkspaceTypeConfig;
} {
  // Sort patterns by specificity (most specific first)
  // More specific = longer pattern, or pattern with suffix after wildcard
  const sortedPatterns = Object.entries(workspaceConfigs).sort(([patternA], [patternB]) => {
    // Count non-wildcard characters (more specific patterns have more)
    const specificityA = patternA.replace(/\*/g, '').length;
    const specificityB = patternB.replace(/\*/g, '').length;

    // Sort by specificity descending (more specific first)
    if (specificityA !== specificityB) {
      return specificityB - specificityA;
    }

    // If same specificity, prefer longer patterns
    return patternB.length - patternA.length;
  });

  // Check each workspace pattern to find a match (most specific first)
  for (const [pattern, config] of sortedPatterns) {
    if (matchesPattern(relativeRoot, pattern)) {
      return {
        workspaceType: config.type,
        workspaceSubType: config.subType || 'unknown',
        workspaceConfig: config,
      };
    }
  }

  // Fallback to heuristics if no pattern matches
  if (relativeRoot.startsWith('apps/') || relativeRoot.startsWith('websites/')) {
    return {
      workspaceType: 'app',
      workspaceSubType: 'other',
      workspaceConfig: undefined,
    };
  }

  if (relativeRoot.startsWith('packages/')) {
    return {
      workspaceType: 'shared-package',
      workspaceSubType: 'library',
      workspaceConfig: undefined,
    };
  }

  // Check by package.json hints
  if (packageJson.main || packageJson.module || packageJson.types || packageJson.exports) {
    return {
      workspaceType: 'shared-package',
      workspaceSubType: 'library',
      workspaceConfig: undefined,
    };
  }

  return {
    workspaceType: 'unknown',
    workspaceSubType: 'unknown',
    workspaceConfig: undefined,
  };
}

function matchesPattern(path: string, pattern: string): boolean {
  // Exact match
  if (path === pattern) return true;

  // Handle patterns with wildcards (e.g., "apps/*", "apps/*-mobile")
  if (pattern.includes('*')) {
    // Convert glob pattern to regex
    // * matches one or more characters (non-greedy, non-slash for path segments)
    const regexPattern = pattern
      .split('/')
      .map((segment) => {
        if (segment === '*') {
          // Segment is just *, match any directory name
          return '[^/]+';
        }
        if (segment.includes('*')) {
          // Segment has * in it (like "*-mobile"), match with wildcard
          return segment.replace(/\*/g, '[^/]+');
        }
        // Literal segment
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex chars
      })
      .join('/');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  return false;
}
