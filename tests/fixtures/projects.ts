import type {
  PackageJson,
  ProjectInfo,
  ProjectInventory,
} from "../../src/core/types.ts";

/**
 * Create a mock ProjectInfo object for testing
 */
export function createMockProject(
  overrides: Partial<ProjectInfo> = {},
): ProjectInfo {
  const defaults: ProjectInfo = {
    id: "@test/project",
    root: "/test/project",
    relativeRoot: "packages/project",
    packageJson: {
      name: "@test/project",
      version: "1.0.0",
    },
    workspaceType: "shared-package",
    workspaceSubType: "library",
    isPrivate: false,
  };

  return { ...defaults, ...overrides };
}

/**
 * Create a mock PackageJson object for testing
 */
export function createMockPackageJson(
  overrides: Partial<PackageJson> = {},
): PackageJson {
  const defaults: PackageJson = {
    name: "@test/package",
    version: "1.0.0",
    dependencies: {},
    devDependencies: {},
    private: false,
  };

  return { ...defaults, ...overrides };
}

/**
 * Create a mock ProjectInventory for testing
 */
export function createMockInventory(
  projects: Record<string, Partial<ProjectInfo>> = {},
): ProjectInventory {
  const mockProjects: Record<string, ProjectInfo> = {};

  for (const [name, overrides] of Object.entries(projects)) {
    mockProjects[name] = createMockProject({
      id: name,
      relativeRoot: `packages/${name.replace("@test/", "")}`,
      packageJson: { name, version: "1.0.0" },
      ...overrides,
    });
  }

  return {
    projects: mockProjects,
    warnings: [],
    workspaceConfigs: {},
  };
}

/**
 * Create a standard test monorepo structure
 */
export const STANDARD_MONOREPO = {
  projects: {
    "@test/web": {
      relativeRoot: "apps/web",
      workspaceType: "app" as const,
      workspaceSubType: "website" as const,
    },
    "@test/mobile": {
      relativeRoot: "apps/mobile",
      workspaceType: "app" as const,
      workspaceSubType: "mobile" as const,
    },
    "@test/utils": {
      relativeRoot: "packages/utils",
      workspaceType: "shared-package" as const,
      workspaceSubType: "library" as const,
    },
    "@test/ui": {
      relativeRoot: "packages/ui",
      workspaceType: "shared-package" as const,
      workspaceSubType: "ui" as const,
    },
  },
};

/**
 * Create a monorepo with circular dependencies for testing
 */
export const CIRCULAR_DEPS_MONOREPO = {
  projects: {
    "@test/a": { relativeRoot: "packages/a" },
    "@test/b": { relativeRoot: "packages/b" },
    "@test/c": { relativeRoot: "packages/c" },
  },
  imports: {
    "@test/a": ["@test/b"],
    "@test/b": ["@test/c"],
    "@test/c": ["@test/a"], // Creates cycle
  },
};

/**
 * Create a monorepo with diamond dependencies
 */
export const DIAMOND_DEPS_MONOREPO = {
  projects: {
    "@test/app": { relativeRoot: "apps/app" },
    "@test/shared-a": { relativeRoot: "packages/shared-a" },
    "@test/shared-b": { relativeRoot: "packages/shared-b" },
    "@test/core": { relativeRoot: "packages/core" },
  },
  imports: {
    "@test/app": ["@test/shared-a", "@test/shared-b"],
    "@test/shared-a": ["@test/core"],
    "@test/shared-b": ["@test/core"], // Diamond pattern
  },
};
