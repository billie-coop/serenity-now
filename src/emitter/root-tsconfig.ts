// Root tsconfig.json management for incremental compilation
// Manages the monorepo root tsconfig with project references

import { join } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";
import type { ProjectInventory, SyncConfig, TsConfig } from "../core/types.ts";
import { log } from "../utils/logging.ts";
import { fileExists } from "../utils/files.ts";

/**
 * Updates the root tsconfig.json with project references for incremental compilation
 * Only touches references and composite settings, preserves all other options
 */
export async function updateRootTsConfig(
  rootDir: string,
  inventory: ProjectInventory,
  config: SyncConfig,
  options: { dryRun?: boolean; verbose?: boolean } = {},
): Promise<{ updated: boolean; diff?: string }> {
  const { dryRun = false, verbose = false } = options;

  // Check if incremental is enabled (defaults to true)
  const incrementalEnabled = config.tsconfig?.incremental !== false;

  if (!incrementalEnabled) {
    if (verbose) {
      log.debug(
        "Incremental compilation disabled in config, skipping root tsconfig",
      );
    }
    return { updated: false };
  }

  // Look for root tsconfig (supports both .json and .jsonc extensions)
  let rootTsconfigPath = join(rootDir, "tsconfig.json");

  // Check if .jsonc exists instead
  if (!await fileExists(rootTsconfigPath)) {
    const jsoncPath = join(rootDir, "tsconfig.jsonc");
    if (await fileExists(jsoncPath)) {
      rootTsconfigPath = jsoncPath;
    }
  }

  // Read existing root tsconfig if it exists
  // Use JSONC parser which handles both JSON and JSON with comments
  let currentTsconfig: TsConfig = {};
  try {
    const content = await Deno.readTextFile(rootTsconfigPath);
    currentTsconfig = parseJsonc(content) as TsConfig;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      log.warn(`Failed to read root tsconfig: ${error}`);
      return { updated: false };
    }
    // File doesn't exist, we'll create it
  }

  // Build list of all projects that have tsconfig files
  const projectReferences: Array<{ path: string }> = [];

  for (const project of Object.values(inventory.projects)) {
    if (project.tsconfigPath) {
      // Use relative path from root to project
      projectReferences.push({
        path: project.relativeRoot,
      });
    }
  }

  // Sort references alphabetically for consistency
  projectReferences.sort((a, b) => a.path.localeCompare(b.path));

  // Create updated tsconfig preserving existing settings
  const updated: TsConfig = {
    ...currentTsconfig,
  };

  // Only set compilerOptions if we need to change something
  if (!updated.compilerOptions) {
    updated.compilerOptions = {};
  }

  // Enable composite mode for project references
  updated.compilerOptions.composite = true;

  // Enable incremental compilation
  updated.compilerOptions.incremental = true;

  // Set references
  updated.references = projectReferences;

  // Add files array to prevent root from trying to compile everything
  // Only include root-level config files if they exist
  if (!updated.files) {
    updated.files = [];
  }

  // Check if anything changed
  const currentJson = JSON.stringify(currentTsconfig, null, 2);
  const updatedJson = JSON.stringify(updated, null, 2);

  if (currentJson === updatedJson) {
    if (verbose) {
      log.debug("Root tsconfig.json is already up to date");
    }
    return { updated: false };
  }

  // Log what we're doing
  log.step("Updating root tsconfig.json for incremental compilation...");

  if (verbose) {
    log.debug(`  Adding ${projectReferences.length} project references`);
    log.debug(`  Enabling composite: true`);
    log.debug(`  Enabling incremental: true`);
  }

  // Create diff for dry-run mode
  let diff: string | undefined;
  if (dryRun) {
    diff = createSimpleDiff(currentJson, updatedJson, rootTsconfigPath);
  }

  // Write the file if not in dry-run mode
  if (!dryRun) {
    await Deno.writeTextFile(rootTsconfigPath, `${updatedJson}\n`);
    log.success("Updated root tsconfig.json");
  } else {
    log.info("[dry-run] Would update root tsconfig.json");
  }

  return { updated: true, diff };
}

/**
 * Creates a simple diff string for visualization
 */
function createSimpleDiff(
  original: string,
  updated: string,
  filePath: string,
): string {
  const originalLines = original.split("\n");
  const updatedLines = updated.split("\n");

  let diff = `--- ${filePath}\n+++ ${filePath} (updated)\n`;

  // Simple line-by-line comparison
  const maxLines = Math.max(originalLines.length, updatedLines.length);

  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i] || "";
    const newLine = updatedLines[i] || "";

    if (origLine !== newLine) {
      if (origLine) {
        diff += `-${origLine}\n`;
      }
      if (newLine) {
        diff += `+${newLine}\n`;
      }
    }
  }

  return diff;
}
