import { parseArgs } from "@std/cli/parse-args";
import { RepoManager } from "../../core/repo_manager.ts";
import type { RepoManagerDeps } from "../../core/ports.ts";
import type { RepoManagerOptions } from "../../core/types.ts";
import { createDefaultDeps } from "../../infra/default_deps.ts";

interface CliArgs {
  help?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  config?: string;
  failOnStale?: boolean;
  force?: boolean;
}

function parseCliArgs(rawArgs: string[]): CliArgs {
  const parsed = parseArgs(rawArgs, {
    boolean: [
      "help",
      "dry-run",
      "verbose",
      "fail-on-stale",
      "force",
      "h",
      "d",
      "v",
      "f",
    ],
    string: ["config", "c"],
    alias: {
      h: "help",
      d: "dry-run",
      v: "verbose",
      c: "config",
      f: "force",
    },
  });

  return {
    help: Boolean(parsed.help),
    dryRun: Boolean(parsed["dry-run"]),
    verbose: Boolean(parsed.verbose),
    config: typeof parsed.config === "string" ? parsed.config : undefined,
    failOnStale: Boolean(parsed["fail-on-stale"]),
    force: Boolean(parsed.force),
  };
}

function printHelp(): void {
  console.log(`serenity-now - dependency sync utility

Usage:
  serenity-now [options]

Options:
  --dry-run, -d        Preview changes without modifying files
  --verbose, -v        Enable verbose logging
  --config, -c <path>  Path to configuration file
  --fail-on-stale      Exit with error if stale dependencies are found
  --force, -f          Continue even if problems are detected
  --help, -h           Show this help message
`);
}

type DepsFactory = (options: RepoManagerOptions) => RepoManagerDeps;

function defaultDepsFactory(options: RepoManagerOptions): RepoManagerDeps {
  return createDefaultDeps({ verbose: options.verbose });
}

export async function runCli(
  rawArgs: string[] = Deno.args,
  depsFactory: DepsFactory = defaultDepsFactory,
): Promise<number> {
  const args = parseCliArgs(rawArgs);

  if (args.help) {
    printHelp();
    return 0;
  }

  const repoOptions: RepoManagerOptions = {
    rootDir: Deno.cwd(),
    configPath: args.config,
    dryRun: args.dryRun,
    verbose: args.verbose,
    failOnStale: args.failOnStale,
  };

  const deps = depsFactory(repoOptions);
  const manager = new RepoManager(repoOptions, deps);

  try {
    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    const usage = await manager.scanImports(inventory);
    const graph = await manager.resolveGraph(inventory, usage);
    const emitResult = await manager.emitChanges(graph, inventory);

    const warnings = [
      ...inventory.warnings,
      ...usage.warnings,
      ...graph.warnings,
      ...emitResult.warnings,
      ...(deps.logger.getWarnings?.() ?? []),
    ];

    if (warnings.length > 0) {
      console.log("\nWarnings:");
      for (const warning of warnings) {
        console.log(` - ${warning}`);
      }
    }

    if (repoOptions.dryRun) {
      console.log("\nDry run complete (no files modified).");
    } else if (emitResult.filesModified > 0) {
      console.log(`\nUpdated ${emitResult.filesModified} file(s).`);
    } else {
      console.log("\nNo changes were necessary.");
    }

    if (
      repoOptions.failOnStale &&
      Object.keys(emitResult.staleDependencies).length > 0
    ) {
      console.error("\nStale dependencies detected.");
      return 1;
    }

    return 0;
  } catch (error) {
    console.error(
      "Error running serenity-now:",
      error instanceof Error ? error.message : error,
    );
    if (repoOptions.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    return 1;
  }
}
