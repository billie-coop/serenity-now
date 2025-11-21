import type { SyncConfig } from "../../src/core/types.ts";

/**
 * Create a mock SyncConfig for testing
 */
export function createMockConfig(
  overrides: Partial<SyncConfig> = {},
): SyncConfig {
  const defaults: SyncConfig = {
    workspaceTypes: {
      "packages/*": {
        type: "shared-package",
        enforceNamePrefix: "@test/",
        packageJsonTemplate: {
          main: "src/index.ts",
          types: "src/index.ts",
        },
        tsconfigTemplate: {
          extends: "../../tsconfig.base.json",
          include: ["src/**/*"],
        },
      },
      "apps/*": {
        type: "app",
        packageJsonTemplate: {
          private: true,
        },
        tsconfigTemplate: {
          extends: "../../tsconfig.base.json",
        },
      },
    },
    defaultDependencies: [],
    ignoreProjects: [],
    ignoreImports: [],
  };

  return { ...defaults, ...overrides };
}

/**
 * Config with strict name enforcement
 */
export const STRICT_CONFIG: SyncConfig = {
  workspaceTypes: {
    "packages/*": {
      type: "shared-package",
      enforceNamePrefix: "@company/",
    },
    "apps/*": {
      type: "app",
      enforceNamePrefix: false,
    },
  },
};

/**
 * Config with default dependencies
 */
export const DEFAULT_DEPS_CONFIG: SyncConfig = {
  workspaceTypes: {
    "**/*": {
      type: "shared-package",
    },
  },
  defaultDependencies: ["@test/core", "@test/logging"],
};

/**
 * Config with ignore patterns
 */
export const IGNORE_PATTERNS_CONFIG: SyncConfig = {
  workspaceTypes: {
    "**/*": {
      type: "shared-package",
    },
  },
  ignoreProjects: ["packages/experimental-*", "apps/_*"],
  ignoreImports: ["node:*", "@testing-library/*", "vitest"],
};

/**
 * Config with multiple workspace patterns and subtypes
 */
export const COMPLEX_WORKSPACE_CONFIG: SyncConfig = {
  workspaceTypes: {
    "apps/*-mobile": {
      type: "app",
      subType: "mobile",
      packageJsonTemplate: {
        private: true,
        main: "index.js",
      },
    },
    "apps/*-web": {
      type: "app",
      subType: "website",
      packageJsonTemplate: {
        private: true,
        type: "module",
      },
    },
    "packages/ui-*": {
      type: "shared-package",
      subType: "ui",
      enforceNamePrefix: "@ui/",
    },
    "packages/*": {
      type: "shared-package",
      subType: "library",
      enforceNamePrefix: "@shared/",
    },
  },
};

/**
 * Config with incremental compilation enabled
 */
export const INCREMENTAL_CONFIG: SyncConfig = {
  workspaceTypes: {
    "**/*": {
      type: "shared-package",
    },
  },
  tsconfig: {
    incremental: true,
  },
};

/**
 * Minimal config
 */
export const MINIMAL_CONFIG: SyncConfig = {
  workspaceTypes: {},
};
