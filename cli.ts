#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
// CLI entry point for serenity-now (Deno version)

import { parseArgs } from "@std/cli/parse-args";
import { RepoManager } from "./src/core/manager.ts";

interface CliOptions {
  dryRun?: boolean;
  verbose?: boolean;
  config?: string;
  force?: boolean;
  failOnStale?: boolean;
}

function parseCliArgs(): CliOptions {
  const args = parseArgs(Deno.args, {
    boolean: [
      "dry-run",
      "d",
      "verbose",
      "v",
      "force",
      "f",
      "fail-on-stale",
      "help",
      "h",
    ],
    string: ["config", "c"],
    alias: {
      d: "dry-run",
      v: "verbose",
      c: "config",
      f: "force",
      h: "help",
    },
  });

  if (args.help || args.h) {
    printHelp();
    Deno.exit(0);
  }

  return {
    dryRun: args["dry-run"] || args.d,
    verbose: args.verbose || args.v,
    config: args.config || args.c,
    force: args.force || args.f,
    failOnStale: args["fail-on-stale"],
  };
}

function printHelp() {
  console.log(`
serenity-now - TypeScript monorepo dependency synchronization

Usage:
  serenity-now [options]

Options:
  --dry-run, -d        Preview changes without modifying files
  --verbose, -v        Show detailed output
  --config, -c <path>  Path to custom configuration file
  --force, -f          Continue even with circular dependencies
  --fail-on-stale      Exit with error if stale dependencies exist
  --help, -h           Show this help message

Examples:
  serenity-now                  # Update dependencies
  serenity-now --dry-run       # Preview changes
  serenity-now --verbose       # Show detailed output
  serenity-now --fail-on-stale # CI mode - fail on stale deps
`);
}

async function main() {
  const options = parseCliArgs();
  const rootDir = Deno.cwd();

  console.log("🔧 SERENITY NOW! Syncing monorepo dependencies...\n");

  const manager = new RepoManager({
    rootDir,
    configPath: options.config,
    dryRun: options.dryRun,
    verbose: options.verbose,
    failOnStale: options.failOnStale,
  });

  try {
    // Phase 0: Load configuration
    await manager.loadConfig();

    // Phase 1: Discover workspace
    const inventory = await manager.discoverWorkspace();
    if (Object.keys(inventory.projects).length === 0) {
      console.error("No projects found in workspace");
      Deno.exit(1);
    }

    const logger = manager.getLogger();
    logger.debug(`Found ${Object.keys(inventory.projects).length} projects`);

    // Phase 2: Scan imports
    const usage = await manager.scanImports(inventory);

    // Phase 3: Resolve graph
    const graph = await manager.resolveGraph(inventory, usage);

    // Check for circular dependencies
    if (graph.cycles.length > 0 && !options.force) {
      logger.error(`Found ${graph.cycles.length} circular dependencies!`);
      for (const cycle of graph.cycles) {
        logger.error(`  Cycle: ${cycle.path.join(" → ")}`);
      }
      logger.error("\nUse --force to continue despite circular dependencies");
      Deno.exit(2);
    }

    // Phase 4: Emit changes
    const result = await manager.emitChanges(graph, inventory);

    // Print summary
    logger.printSummary({
      projectsScanned: Object.keys(inventory.projects).length,
      filesModified: result.filesModified,
      staleRemoved: Object.values(result.staleDependencies).reduce(
        (sum, stale) =>
          sum + stale.packageJsonDeps.length + stale.tsconfigPaths.length,
        0,
      ),
    });

    // Handle stale dependencies in audit mode
    if (
      options.failOnStale && Object.keys(result.staleDependencies).length > 0
    ) {
      logger.error("\nStale dependencies detected! Run sync-deps to fix.");
      Deno.exit(5);
    }

    // Show warnings
    const allWarnings = [
      ...inventory.warnings,
      ...usage.warnings,
      ...graph.warnings,
      ...result.warnings,
      ...logger.getWarnings(),
    ];

    if (allWarnings.length > 0) {
      console.log("\n⚠️  Warnings:");
      for (const w of allWarnings) {
        console.log(`   ${w}`);
      }
    }

    if (options.dryRun) {
      console.log("\n✨ Dry run complete (no files modified)");
    } else if (result.filesModified > 0) {
      console.log(`\n✨ Successfully updated ${result.filesModified} files`);
    } else {
      console.log("\n✨ All dependencies are already in sync");
    }
  } catch (error) {
    console.error(
      "\n❌ Error:",
      error instanceof Error ? error.message : error,
    );
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    Deno.exit(3);
  }
}

// Run the CLI
if (import.meta.main) {
  await main();
}
