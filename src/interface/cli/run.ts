import { parseArgs } from "@std/cli/parse-args";
import { RepoManager } from "../../core/repo_manager.ts";
import type { RepoManagerDeps } from "../../core/ports.ts";
import type {
  ProjectInventory,
  ProjectUsage,
  RepoManagerOptions,
  ResolvedGraph,
} from "../../core/types.ts";
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
  --force, -f          Continue even with circular dependencies
  --help, -h           Show this help message
`);
}

type DepsFactory = (options: RepoManagerOptions) => RepoManagerDeps;

function defaultDepsFactory(options: RepoManagerOptions): RepoManagerDeps {
  return createDefaultDeps({ verbose: options.verbose });
}

function analyzeImportUsage(
  usage: ProjectUsage,
  inventory: ProjectInventory,
): void {
  console.log("\nImport Analysis:");

  const stats = {
    totalProjects: Object.keys(usage.usage).length,
    totalDependencies: 0,
    totalTypeOnlyDependencies: 0,
    mostUsedPackages: {} as Record<string, number>,
    unusedPackages: new Set(Object.keys(inventory.projects)),
  };

  for (const [projectId, record] of Object.entries(usage.usage)) {
    stats.totalDependencies += record.dependencies.length;
    stats.totalTypeOnlyDependencies += record.typeOnlyDependencies.length;

    for (
      const dep of [...record.dependencies, ...record.typeOnlyDependencies]
    ) {
      stats.mostUsedPackages[dep] = (stats.mostUsedPackages[dep] || 0) + 1;
      stats.unusedPackages.delete(dep);
    }

    stats.unusedPackages.delete(projectId);
  }

  console.log(`  - Projects with imports: ${stats.totalProjects}`);
  console.log(`  - Total runtime dependencies: ${stats.totalDependencies}`);
  console.log(
    `  - Total type-only dependencies: ${stats.totalTypeOnlyDependencies}`,
  );

  const sortedPackages = Object.entries(stats.mostUsedPackages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sortedPackages.length > 0) {
    console.log("  - Most used packages:");
    for (const [pkg, count] of sortedPackages) {
      console.log(`      ${pkg}: used by ${count} project(s)`);
    }
  }

  if (stats.unusedPackages.size > 0) {
    console.log(
      `  - Potentially unused packages: ${stats.unusedPackages.size}`,
    );
    const unusedSharedPackages = Array.from(stats.unusedPackages).filter(
      (pkg) => {
        const project = inventory.projects[pkg];
        return project && project.workspaceType === "shared-package";
      },
    );
    if (unusedSharedPackages.length > 0) {
      for (const pkg of unusedSharedPackages) {
        console.log(`      ${pkg}`);
      }
    }
  }
}

function analyzeGraph(graph: ResolvedGraph): void {
  console.log("\nDependency Graph Analysis:");

  const projectDeps = Object.entries(graph.projects)
    .map(([id, project]) => ({
      id,
      count: Object.keys(project.dependencies).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (projectDeps.length > 0) {
    console.log("  - Projects with most dependencies:");
    for (const { id, count } of projectDeps) {
      console.log(`      ${id}: ${count} dependencies`);
    }
  }

  const dependedUpon: Record<string, number> = {};
  for (const project of Object.values(graph.projects)) {
    for (const depId of Object.keys(project.dependencies)) {
      dependedUpon[depId] = (dependedUpon[depId] || 0) + 1;
    }
  }

  const mostDepended = Object.entries(dependedUpon)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (mostDepended.length > 0) {
    console.log("  - Most depended-upon packages:");
    for (const [id, count] of mostDepended) {
      console.log(`      ${id}: ${count} project(s) depend on it`);
    }
  }
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
    force: args.force,
  };

  const deps = depsFactory(repoOptions);
  const manager = new RepoManager(repoOptions, deps);

  console.log("🔧 Syncing monorepo dependencies...\n");

  try {
    console.log("\n═══ Loading Configuration ═══\n");
    await manager.loadConfig();

    console.log("\n═══ Discovering Workspace ═══\n");
    const inventory = await manager.discoverWorkspace();

    console.log("\n═══ Scanning Imports ═══\n");
    const usage = await manager.scanImports(inventory);

    console.log("\n═══ Resolving Dependency Graph ═══\n");
    const graph = await manager.resolveGraph(inventory, usage);

    // Check for circular dependencies
    if (graph.cycles.length > 0) {
      if (!repoOptions.force) {
        console.error(
          `\nFound ${graph.cycles.length} circular dependency cycle(s)!`,
        );
        for (const cycle of graph.cycles) {
          console.error(`  Cycle: ${cycle.path.join(" → ")}`);
        }
        console.error(
          "\nUse --force to continue despite circular dependencies",
        );
        return 2;
      } else {
        console.log(
          `\n⚠ Warning: Found ${graph.cycles.length} circular dependency cycle(s) (continuing with --force):`,
        );
        for (const cycle of graph.cycles) {
          console.log(`  Cycle: ${cycle.path.join(" → ")}`);
        }
      }
    }

    console.log("\n═══ Emitting Changes ═══\n");
    const emitResult = await manager.emitChanges(graph, inventory);

    if (repoOptions.verbose) {
      console.log("\n▶ Import Analysis");
      analyzeImportUsage(usage, inventory);
      console.log("\n▶ Dependency Graph Analysis");
      analyzeGraph(graph);
    }

    const warnings = [
      ...inventory.warnings,
      ...usage.warnings,
      ...graph.warnings,
      ...emitResult.warnings,
      ...(deps.logger.getWarnings?.() ?? []),
    ];

    if (graph.diamonds.length > 0 && repoOptions.verbose) {
      console.log("\n▶ Diamond Dependencies");
      for (const diamond of graph.diamonds) {
        console.log(`\n  📦 ${diamond.projectId}:`);
        console.log(`      → ${diamond.directDependency}`);
        console.log(
          `        (also via: ${diamond.transitiveThrough.join(", ")})`,
        );
      }
    }

    if (warnings.length > 0) {
      console.log("\nWarnings:");
      for (const warning of warnings) {
        console.log(` - ${warning}`);
      }
    }

    console.log("\n═══ Summary ═══");
    console.log(
      `  Projects scanned: ${Object.keys(inventory.projects).length}`,
    );
    if (repoOptions.dryRun) {
      console.log(`  Files to modify: ${emitResult.filesModified}`);
      console.log("\n✨ Dry run complete (no files modified).");
    } else if (emitResult.filesModified > 0) {
      console.log(`  Files modified: ${emitResult.filesModified}`);
      console.log(`\n✅ Updated ${emitResult.filesModified} file(s).`);
    } else {
      console.log(`  Files modified: 0`);
      console.log("\n✅ All dependencies are already in sync!");
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
