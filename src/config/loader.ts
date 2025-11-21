// Phase 0: Configuration loading

import * as path from 'node:path';
import type { RepoManager } from '../core/manager';
import type { SyncConfig } from '../core/types';
import { fileExists, tryReadJson } from '../utils/files';

const DEFAULT_CONFIG: SyncConfig = {
  workspaceTypes: {
    'apps/*': {
      type: 'app',
      enforceNamePrefix: false,
    },
    'packages/*': {
      type: 'shared-package',
      enforceNamePrefix: '@billie-coop/',
    },
    'websites/*': {
      type: 'app',
      enforceNamePrefix: false,
    },
  },
  defaultDependencies: ['@billie-coop/ts-utils'],
  ignoreProjects: [],
  ignoreImports: [],
  tsconfig: {
    preserveOutDir: true,
    typeOnlyInDevDependencies: true,
  },
};

export async function loadSyncConfig(manager: RepoManager): Promise<SyncConfig> {
  const logger = manager.getLogger();

  // Try to find config file
  const configPath = manager.getConfigPath() || path.join(manager.root, 'sync-deps.config.json');

  logger.debug(`Looking for config at: ${configPath}`);

  if (!(await fileExists(configPath))) {
    logger.debug('No config file found, using defaults');
    return DEFAULT_CONFIG;
  }

  logger.step(`Loading config from ${path.basename(configPath)}`);

  const userConfig = await tryReadJson<SyncConfig>(configPath, {});

  // Merge with defaults
  const config: SyncConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    workspaceTypes: {
      ...DEFAULT_CONFIG.workspaceTypes,
      ...userConfig.workspaceTypes,
    },
    tsconfig: {
      ...DEFAULT_CONFIG.tsconfig,
      ...userConfig.tsconfig,
    },
  };

  // Handle deprecated enforceNamePrefix
  if (userConfig.enforceNamePrefix && !userConfig.workspaceTypes) {
    logger.warn('enforceNamePrefix is deprecated. Use workspaceTypes configuration instead.');
  }

  // Validate and warn about unknown fields
  const knownFields = new Set([
    'workspaceTypes',
    'enforceNamePrefix', // Keep for backwards compatibility
    'defaultDependencies',
    'ignoreProjects',
    'ignoreImports',
    'tsconfig',
  ]);

  for (const key of Object.keys(userConfig)) {
    if (!knownFields.has(key)) {
      logger.warn(`Unknown config field: ${key}`);
    }
  }

  logger.debug(`Config loaded: ${JSON.stringify(config, null, 2)}`);

  return config;
}
