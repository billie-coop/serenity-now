// Phase 0: Configuration loading
// Deno version

import { join } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";
import type { RepoManager } from "../core/manager.ts";
import type { SyncConfig } from "../core/types.ts";
import { fileExists } from "../utils/files.ts";
import { SyncConfigSchema } from "./schema.ts";

async function findConfigFile(
  rootDir: string,
  customPath?: string,
): Promise<string | null> {
  // If custom path provided, use it
  if (customPath) {
    if (await fileExists(customPath)) {
      return customPath;
    }
    return null;
  }

  // Search for config files in order of preference
  const configNames = [
    "serenity-now.config.jsonc",
    "serenity-now.config.json",
  ];

  for (const name of configNames) {
    const path = join(rootDir, name);
    if (await fileExists(path)) {
      return path;
    }
  }

  return null;
}

async function createConfigWithPrompt(rootDir: string): Promise<void> {
  const configPath = join(rootDir, "serenity-now.config.jsonc");

  const configTemplate = `{
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
    },

    // Example: Match all shared packages
    "packages/*": {
      "type": "shared-package",
      "enforceNamePrefix": "@mycompany/"
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

  // Optional: TypeScript configuration
  "tsconfig": {
    // Enable incremental compilation with project references (recommended)
    // "incremental": true  // Default: true
  }
}`;

  console.log("\n📝 No configuration file found!");
  console.log(
    `Creating ${configPath.split("/").pop()} with helpful comments...`,
  );

  await Deno.writeTextFile(configPath, configTemplate);

  console.log("\n✅ Configuration file created!");
  console.log(
    "Please edit the file to match your monorepo structure and run again.",
  );
  console.log(`\nFile location: ${configPath}`);
}

export async function loadSyncConfig(
  manager: RepoManager,
): Promise<SyncConfig> {
  const logger = manager.getLogger();

  // Try to find config file
  const configPath = await findConfigFile(
    manager.root,
    manager.getConfigPath(),
  );

  if (!configPath) {
    await createConfigWithPrompt(manager.root);
    Deno.exit(0);
  }

  logger.step(`Loading config from ${configPath.split("/").pop()}`);

  // Read file content
  const configContent = await Deno.readTextFile(configPath);

  // Parse as JSONC (handles both JSON and JSONC)
  const rawConfig = parseJsonc(configContent);

  // Validate config with Zod schema
  const parseResult = SyncConfigSchema.safeParse(rawConfig);

  if (!parseResult.success) {
    logger.error("Configuration validation failed:");
    for (const issue of parseResult.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      logger.error(`  ${path}${issue.message}`);
    }
    throw new Error("Invalid configuration format");
  }

  const config = parseResult.data as SyncConfig;

  // Handle deprecated enforceNamePrefix
  if (config.enforceNamePrefix && !config.workspaceTypes) {
    logger.warn(
      "enforceNamePrefix is deprecated. Use workspaceTypes configuration instead.",
    );
  }

  logger.debug(
    `Config loaded and validated: ${JSON.stringify(config, null, 2)}`,
  );

  return config;
}
