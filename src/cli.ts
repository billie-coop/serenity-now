#!/usr/bin/env node
// CLI entry point for serenity-now

import * as process from 'node:process';
import { RepoManager } from './core/manager';

interface CliOptions {
  dryRun?: boolean;
  verbose?: boolean;
  config?: string;
  force?: boolean;
  failOnStale?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
      case '-d':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--config':
      case '-c':
        options.config = args[++i];
        break;
      case '--force':
      case '-f':
        options.force = true;
        break;
      case '--fail-on-stale':
        options.failOnStale = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
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
  const options = parseArgs();
  const rootDir = process.cwd();

  console.log('🔧 SERENITY NOW! Syncing monorepo dependencies...\n');

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
      console.error('No projects found in workspace');
      process.exit(1);
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
        logger.error(`  Cycle: ${cycle.path.join(' → ')}`);
      }
      logger.error('\nUse --force to continue despite circular dependencies');
      process.exit(2);
    }

    // Phase 4: Emit changes
    const result = await manager.emitChanges(graph);

    // Print summary
    logger.printSummary({
      projectsScanned: Object.keys(inventory.projects).length,
      filesModified: result.filesModified,
      staleRemoved: Object.values(result.staleDependencies).reduce(
        (sum, stale) => sum + stale.packageJsonDeps.length + stale.tsconfigPaths.length,
        0,
      ),
    });

    // Handle stale dependencies in audit mode
    if (options.failOnStale && Object.keys(result.staleDependencies).length > 0) {
      logger.error('\nStale dependencies detected! Run sync-deps to fix.');
      process.exit(5);
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
      console.log('\n⚠️  Warnings:');
      for (const w of allWarnings) {
        console.log(`   ${w}`);
      }
    }

    if (options.dryRun) {
      console.log('\n✨ Dry run complete (no files modified)');
    } else if (result.filesModified > 0) {
      console.log(`\n✨ Successfully updated ${result.filesModified} files`);
    } else {
      console.log('\n✨ All dependencies are already in sync');
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(3);
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(3);
});
