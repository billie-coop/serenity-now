import { isAbsolute, join } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";
import type {
  ConfigLoaderPort,
  FileSystemPort,
  LoggerPort,
} from "../../core/ports.ts";
import type {
  PackageJson,
  RepoManagerOptions,
  SyncConfig,
  TsConfig,
  WorkspaceTypeConfig,
} from "../../core/types.ts";
import { assert } from "../../core/utils/assert.ts";

const DEFAULT_CONFIG_FILES = [
  "serenity-now.config.jsonc",
  "serenity-now.config.json",
];

function getDefaultConfigFilename(): string {
  const candidate = DEFAULT_CONFIG_FILES[0];
  assert(
    candidate,
    () => new ConfigError("No default config filenames configured"),
  );
  return candidate;
}

const CONFIG_TEMPLATE = `{
  // Serenity Now! Configuration
  // This file configures how dependencies are synchronized across your monorepo

  // Define workspace types and their configurations
  "workspaceTypes": {
    // Example: Match all projects in apps/ directory
    "apps/*": {
      "type": "app",  // "app" or "shared-package"
      // Optional: Categorize further (mobile, db, website, etc.)
      // "subType": "website",

      // Optional: Enforce package name prefix
      // "enforceNamePrefix": "@mycompany/",

      // Optional: Template for package.json fields
      // "packageJsonTemplate": {
      //   "private": true
      // },

      // Optional: Template for tsconfig.json
      // "tsconfigTemplate": {
      //   "extends": "../../tsconfig.base.json"
      // }
    }
  },

  // Optional: Dependencies to always include in every project
  "defaultDependencies": [],

  // Optional: Projects to ignore during scanning
  "ignoreProjects": [],

  // Optional: Import patterns to ignore
  "ignoreImports": [
    // Example: "react", "node:*"
  ],

  // Optional: TypeScript configuration defaults
  "tsconfig": {
    // Enable incremental compilation with project references (recommended)
    // "incremental": true  // Default: true
  }
}
`;

class ConfigError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ConfigError(`${field} must be an object`);
  }
  return value;
}

function ensureStringArray(
  value: unknown,
  field: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${field} must be an array of strings`);
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ConfigError(`${field} must contain only strings`);
    }
  }
  return [...value];
}

function ensureBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(`${field} must be a boolean`);
  }
  return value;
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ConfigError(`${field} must be a string`);
  }
  return value;
}

function parseWorkspaceTypes(
  value: unknown,
): Record<string, WorkspaceTypeConfig> {
  const record = ensureRecord(value, "workspaceTypes");
  const result: Record<string, WorkspaceTypeConfig> = {};

  for (const [pattern, configValue] of Object.entries(record)) {
    const configRecord = ensureRecord(
      configValue,
      `workspaceTypes["${pattern}"]`,
    );
    const type = configRecord.type;
    if (type !== "app" && type !== "shared-package") {
      throw new ConfigError(
        `workspaceTypes["${pattern}"].type must be "app" or "shared-package"`,
      );
    }

    const workspaceConfig: WorkspaceTypeConfig = {
      type,
    };

    if (configRecord.subType !== undefined) {
      workspaceConfig.subType = ensureString(
        configRecord.subType,
        `workspaceTypes["${pattern}"].subType`,
      ) as WorkspaceTypeConfig["subType"];
    }

    if (configRecord.enforceNamePrefix !== undefined) {
      const prefix = configRecord.enforceNamePrefix;
      if (prefix !== false && typeof prefix !== "string") {
        throw new ConfigError(
          `workspaceTypes["${pattern}"].enforceNamePrefix must be a string or false`,
        );
      }
      workspaceConfig.enforceNamePrefix = prefix;
    }

    if (configRecord.packageJsonTemplate !== undefined) {
      workspaceConfig.packageJsonTemplate = ensureRecord(
        configRecord.packageJsonTemplate,
        `workspaceTypes["${pattern}"].packageJsonTemplate`,
      ) as Partial<PackageJson>;
    }

    if (configRecord.tsconfigTemplate !== undefined) {
      workspaceConfig.tsconfigTemplate = ensureRecord(
        configRecord.tsconfigTemplate,
        `workspaceTypes["${pattern}"].tsconfigTemplate`,
      ) as Partial<TsConfig>;
    }

    result[pattern] = workspaceConfig;
  }

  return result;
}

function parseTsConfig(value: unknown): SyncConfig["tsconfig"] {
  const record = ensureRecord(value, "tsconfig");
  const result: NonNullable<SyncConfig["tsconfig"]> = {};

  if (record.preserveOutDir !== undefined) {
    result.preserveOutDir = ensureBoolean(
      record.preserveOutDir,
      "tsconfig.preserveOutDir",
    );
  }
  if (record.typeOnlyInDevDependencies !== undefined) {
    result.typeOnlyInDevDependencies = ensureBoolean(
      record.typeOnlyInDevDependencies,
      "tsconfig.typeOnlyInDevDependencies",
    );
  }
  if (record.incremental !== undefined) {
    result.incremental = ensureBoolean(
      record.incremental,
      "tsconfig.incremental",
    );
  }

  return result;
}

function validateSyncConfig(raw: unknown): SyncConfig {
  const record = ensureRecord(raw, "config");
  const config: SyncConfig = {};

  if (record.workspaceTypes !== undefined) {
    config.workspaceTypes = parseWorkspaceTypes(record.workspaceTypes);
  }
  if (record.defaultDependencies !== undefined) {
    config.defaultDependencies = ensureStringArray(
      record.defaultDependencies,
      "defaultDependencies",
    );
  }
  if (record.ignoreProjects !== undefined) {
    config.ignoreProjects = ensureStringArray(
      record.ignoreProjects,
      "ignoreProjects",
    );
  }
  if (record.ignoreImports !== undefined) {
    config.ignoreImports = ensureStringArray(
      record.ignoreImports,
      "ignoreImports",
    );
  }
  if (record.excludePatterns !== undefined) {
    config.excludePatterns = ensureStringArray(
      record.excludePatterns,
      "excludePatterns",
    );
  }
  if (record.universalUtilities !== undefined) {
    config.universalUtilities = ensureStringArray(
      record.universalUtilities,
      "universalUtilities",
    );
  }
  if (record.enforceNamePrefix !== undefined) {
    config.enforceNamePrefix = ensureString(
      record.enforceNamePrefix,
      "enforceNamePrefix",
    );
  }
  if (record.tsconfig !== undefined) {
    config.tsconfig = parseTsConfig(record.tsconfig);
  }

  return config;
}

async function findConfigPath(
  fs: FileSystemPort,
  rootDir: string,
  customPath?: string,
): Promise<string | undefined> {
  if (customPath) {
    const resolved = isAbsolute(customPath)
      ? customPath
      : join(rootDir, customPath);
    if (await fs.fileExists(resolved)) {
      return resolved;
    }
    return undefined;
  }

  for (const filename of DEFAULT_CONFIG_FILES) {
    const candidate = join(rootDir, filename);
    if (await fs.fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function createConfigTemplate(
  fs: FileSystemPort,
  rootDir: string,
  targetPath?: string,
): Promise<string> {
  const configPath = targetPath
    ? (isAbsolute(targetPath) ? targetPath : join(rootDir, targetPath))
    : join(rootDir, getDefaultConfigFilename());

  await fs.writeText(configPath, CONFIG_TEMPLATE);
  return configPath;
}

async function loadConfigFromFile(
  path: string,
  fs: FileSystemPort,
): Promise<unknown> {
  const contents = await fs.readText(path);
  return parseJsonc(contents);
}

export function createConfigLoader(): ConfigLoaderPort {
  return {
    async load(
      options: RepoManagerOptions,
      logger: LoggerPort,
      fs: FileSystemPort,
    ): Promise<SyncConfig> {
      const configPath = await findConfigPath(
        fs,
        options.rootDir,
        options.configPath,
      );

      if (!configPath) {
        const createdPath = await createConfigTemplate(
          fs,
          options.rootDir,
          options.configPath,
        );
        logger.info(
          `Created serenity-now config template at ${createdPath}. Please customize it and rerun.`,
        );
        throw new ConfigError("Configuration file created");
      }

      logger.info(`Loading serenity-now config from ${configPath}`);

      const rawConfig = await loadConfigFromFile(configPath, fs);
      const config = validateSyncConfig(rawConfig);

      if (config.enforceNamePrefix && !config.workspaceTypes) {
        logger.warn(
          "enforceNamePrefix is deprecated. Use workspaceTypes configuration instead.",
        );
      }

      return config;
    },
  };
}
