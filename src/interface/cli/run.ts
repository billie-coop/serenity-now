import { join } from "node:path";
import { ConfigurationError } from "../../core/errors.js";
import type { RepoManagerDeps } from "../../core/ports.js";
import { RepoManager } from "../../core/repo_manager.js";
import type { RepoManagerOptions } from "../../core/types.js";
import { analyzeExportUsage } from "../../core/unused_exports.js";
import { createDefaultDeps } from "../../infra/default_deps.js";
import { type CliArgs, parseCliArgs, UsageError } from "./args.js";
import { formatHelp } from "./help.js";
import { formatHealthReport } from "./output/health.js";
import { formatMarkdownReport } from "./output/markdown_report.js";
import { formatSyncResult } from "./output/sync_summary.js";
import {
	formatUnusedExports,
	unanalyzedPackages,
} from "./output/unused_exports.js";

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_CYCLES = 2;

const REPORT_FILENAME = "serenity-now-summary.md";

type DepsFactory = (options: RepoManagerOptions) => RepoManagerDeps;

export async function runCli(
	rawArgs: string[],
	depsFactory: DepsFactory = (options) =>
		createDefaultDeps({ verbose: options.verbose }),
): Promise<number> {
	let args: CliArgs;
	try {
		args = parseCliArgs(rawArgs);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(`${error.message}\nRun 'serenity-now --help' for usage.`);
		return EXIT_FAILURE;
	}
	if (args.help) {
		console.log(formatHelp());
		return EXIT_OK;
	}

	const options: RepoManagerOptions = {
		rootDir: process.cwd(),
		configPath: args.config,
		dryRun: args.dryRun || args.check,
		verbose: args.verbose,
	};
	const deps = depsFactory(options);

	try {
		return await runCommand(args, options, deps);
	} catch (error) {
		if (error instanceof ConfigurationError) {
			deps.logger.error(error.message);
		} else {
			deps.logger.error(
				`serenity-now failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (args.verbose && error instanceof Error && error.stack) {
				console.error(error.stack);
			}
		}
		return EXIT_FAILURE;
	}
}

async function runCommand(
	args: CliArgs,
	options: RepoManagerOptions,
	deps: RepoManagerDeps,
): Promise<number> {
	const manager = new RepoManager(options, deps);
	const print = (lines: string[]) => console.log(lines.join("\n"));
	const needsExports =
		args.command === "detect-unused-exports" ||
		args.command === "generate-report";

	await manager.loadConfig();
	const inventory = await manager.discoverWorkspace();
	const analysis = await manager.analyzeSources(inventory, {
		includeExports: needsExports,
	});
	const graph = manager.resolveGraph(inventory, analysis);

	switch (args.command) {
		case "health":
			deps.logger.phase("Health Report");
			print(formatHealthReport(graph));
			return EXIT_OK;

		case "detect-unused-exports":
			deps.logger.phase("Unused Exports");
			print(
				formatUnusedExports(
					analyzeExportUsage(inventory, analysis),
					unanalyzedPackages(inventory, analysis),
					{ verbose: args.verbose },
				),
			);
			return EXIT_OK;

		case "generate-report": {
			const reportPath = join(options.rootDir, REPORT_FILENAME);
			await deps.fileSystem.writeText(
				reportPath,
				formatMarkdownReport({
					inventory,
					graph,
					exportUsage: analyzeExportUsage(inventory, analysis),
					unanalyzed: unanalyzedPackages(inventory, analysis),
					generatedAt: new Date(),
				}),
			);
			deps.logger.success(`Report written to ${reportPath}`);
			return EXIT_OK;
		}

		case "sync": {
			if (graph.cycles.length > 0) {
				const cycles = graph.cycles.map((c) => `  ${c.path.join(" → ")}`);
				if (!args.force) {
					deps.logger.error(
						`Found ${graph.cycles.length} circular dependency cycle(s):\n${cycles.join("\n")}\nUse --force to sync anyway.`,
					);
					return EXIT_CYCLES;
				}
				deps.logger.warn(
					`Syncing despite ${graph.cycles.length} circular dependency cycle(s) (--force):\n${cycles.join("\n")}`,
				);
			}

			const result = await manager.emitChanges(graph, inventory);
			print(
				formatSyncResult(result, options.rootDir, {
					dryRun: !!options.dryRun,
					projectCount: Object.keys(inventory.projects).length,
				}),
			);
			const warnings = deps.logger.getWarnings().length;
			if (warnings > 0) {
				console.log(`${warnings} warning(s), see above.`);
			}
			if (args.check && result.fileChanges.length > 0) {
				deps.logger.error(
					"Files are out of sync. Run serenity-now to fix them.",
				);
				return EXIT_FAILURE;
			}
			return EXIT_OK;
		}
	}
}
