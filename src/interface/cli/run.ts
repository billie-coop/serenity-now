import { join } from "node:path";
import type { RepoManagerDeps } from "../../core/ports.js";
import { RepoManager } from "../../core/repo_manager.js";
import type {
	ProjectInventory,
	ProjectUsage,
	RepoManagerOptions,
	ResolvedGraph,
	UnusedExport,
	UnusedExportsReport,
} from "../../core/types.js";
import { DOCS } from "../../docs/content.js";
import { createDefaultDeps } from "../../infra/default_deps.js";
import { parseArgs } from "../../infra/utils/parseArgs.js";

interface CliArgs {
	command?: string;
	help?: boolean;
	dryRun?: boolean;
	verbose?: boolean;
	config?: string;
	failOnStale?: boolean;
	force?: boolean;
	health?: boolean;
	fixExports?: boolean;
}

function parseCliArgs(rawArgs: string[]): CliArgs {
	// Check if first arg is a command (doesn't start with -)
	let command: string | undefined;
	let argsToProcess = rawArgs;

	if (rawArgs.length > 0 && !rawArgs[0]?.startsWith("-")) {
		command = rawArgs[0];
		argsToProcess = rawArgs.slice(1);
	}

	const parsed = parseArgs(argsToProcess, {
		boolean: [
			"help",
			"dry-run",
			"verbose",
			"fail-on-stale",
			"force",
			"health",
			"fix-exports",
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
		command,
		help: Boolean(parsed.help),
		dryRun: Boolean(parsed["dry-run"]),
		verbose: Boolean(parsed.verbose),
		config: typeof parsed.config === "string" ? parsed.config : undefined,
		failOnStale: Boolean(parsed["fail-on-stale"]),
		force: Boolean(parsed.force),
		health: Boolean(parsed.health),
		fixExports: Boolean(parsed["fix-exports"]),
	};
}

function printHelp(): void {
	console.log(`serenity-now - ${DOCS.tagline}

${DOCS.description}

Usage:
  serenity-now [options]

Options:`);

	for (const opt of DOCS.options) {
		const padding = " ".repeat(Math.max(0, 25 - opt.flag.length));
		console.log(`  ${opt.flag}${padding}${opt.description}`);
	}

	console.log(`
Examples:
  ${DOCS.usage.basic}          Run sync
  ${DOCS.usage.dryRun}   Preview changes
  ${DOCS.usage.health}       Show health report

Run 'serenity-now --help' for more information.
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

	for (const [_projectId, record] of Object.entries(usage.usage)) {
		stats.totalDependencies += record.dependencies.length;
		stats.totalTypeOnlyDependencies += record.typeOnlyDependencies.length;

		for (const dep of [
			...record.dependencies,
			...record.typeOnlyDependencies,
		]) {
			stats.mostUsedPackages[dep] = (stats.mostUsedPackages[dep] || 0) + 1;
			stats.unusedPackages.delete(dep);
		}
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

function printHealthReport(
	graph: ResolvedGraph,
	inventory: ProjectInventory,
	config: { defaultDependencies?: string[] },
): void {
	console.log("\n═══ Health Check ═══\n");

	const defaultDeps = new Set(config.defaultDependencies || []);

	// Group diamonds by package
	const diamondsByPackage = new Map<
		string,
		Array<{ projectId: string; transitiveThrough: string[] }>
	>();

	for (const diamond of graph.diamonds) {
		if (!diamondsByPackage.has(diamond.directDependency)) {
			diamondsByPackage.set(diamond.directDependency, []);
		}
		diamondsByPackage.get(diamond.directDependency)?.push({
			projectId: diamond.projectId,
			transitiveThrough: diamond.transitiveThrough,
		});
	}

	// Separate universal utilities from actionable diamonds
	const universalDiamonds: Array<[string, number]> = [];
	const actionableDiamonds: Array<
		[string, Array<{ projectId: string; transitiveThrough: string[] }>]
	> = [];

	for (const [pkg, occurrences] of diamondsByPackage.entries()) {
		if (defaultDeps.has(pkg)) {
			universalDiamonds.push([pkg, occurrences.length]);
		} else {
			actionableDiamonds.push([pkg, occurrences]);
		}
	}

	// Sort by occurrence count
	actionableDiamonds.sort((a, b) => b[1].length - a[1].length);

	const totalActionable = actionableDiamonds.reduce(
		(sum, [, occurrences]) => sum + occurrences.length,
		0,
	);

	console.log(
		`Diamond Dependencies (${totalActionable} total, excluding universal utilities):\n`,
	);

	// Show actionable diamonds
	for (const [pkg, occurrences] of actionableDiamonds.slice(0, 10)) {
		console.log(`${pkg} (${occurrences.length} occurrences):`);
		for (const { projectId, transitiveThrough } of occurrences.slice(0, 3)) {
			const throughList =
				transitiveThrough.length > 3
					? `${transitiveThrough.slice(0, 3).join(", ")}, ...`
					: transitiveThrough.join(", ");
			console.log(`  - ${projectId}: direct + via [${throughList}]`);
		}
		if (occurrences.length > 3) {
			console.log(`  ... and ${occurrences.length - 3} more`);
		}
		console.log();
	}

	if (actionableDiamonds.length > 10) {
		console.log(
			`... and ${actionableDiamonds.length - 10} more packages with diamonds\n`,
		);
	}

	// Show universal utilities summary
	if (universalDiamonds.length > 0) {
		console.log("Universal utilities (configured as defaultDependencies):");
		for (const [pkg, count] of universalDiamonds) {
			console.log(`  - ${pkg}: ${count} occurrences (expected)`);
		}
		console.log();
	}

	// Show other warnings
	const missingTsconfig = inventory.warnings.filter((w) =>
		w.includes("missing tsconfig"),
	);
	if (missingTsconfig.length > 0) {
		console.log("Missing tsconfig.json:");
		for (const warning of missingTsconfig) {
			const match = warning.match(/Project (.+) at (.+) is missing/);
			if (match) {
				console.log(`  - ${match[1]} (${match[2]})`);
			}
		}
		console.log();
	}

	if (graph.cycles.length > 0) {
		console.log(`⚠️  Circular Dependencies: ${graph.cycles.length} detected`);
		for (const cycle of graph.cycles) {
			console.log(`  - ${cycle.path.join(" → ")}`);
		}
		console.log();
	} else {
		console.log("✓ No circular dependencies\n");
	}
}

export async function runCli(
	rawArgs: string[],
	depsFactory: DepsFactory = defaultDepsFactory,
): Promise<number> {
	const args = parseCliArgs(rawArgs);

	if (args.help) {
		printHelp();
		return 0;
	}

	const repoOptions: RepoManagerOptions = {
		rootDir: process.cwd(),
		configPath: args.config,
		dryRun: args.dryRun,
		verbose: args.verbose,
		failOnStale: args.failOnStale,
		force: args.force,
		health: args.health,
	};

	const deps = depsFactory(repoOptions);
	const manager = new RepoManager(repoOptions, deps);

	console.log("🔧 Syncing monorepo dependencies...\n");
	if (args.command) {
		console.log(`📋 Command: ${args.command}\n`);
	}

	try {
		console.log("\n═══ Loading Configuration ═══\n");
		await manager.loadConfig();

		console.log("\n═══ Discovering Workspace ═══\n");
		const inventory = await manager.discoverWorkspace();

		console.log("\n═══ Scanning Imports ═══\n");
		const usage = await manager.scanImports(inventory);

		// Optional: Scan exports and detect unused exports
		const exportsAnalysis = await manager.scanExports(inventory);
		let unusedExportsReport: UnusedExportsReport | undefined;
		if (exportsAnalysis) {
			unusedExportsReport = await manager.detectUnusedExports(
				exportsAnalysis,
				usage,
				inventory,
			);
		}

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

		// Show health report if requested
		if (repoOptions.health) {
			const config = await manager.getConfig();
			printHealthReport(graph, inventory, config);
			return 0;
		}

		// Handle generate-report command
		if (args.command === "generate-report") {
			console.log("\n═══ Generating Report ═══\n");
			const { generateMarkdownReport } = await import(
				"../../infra/report/markdown_reporter.js"
			);
			const report = generateMarkdownReport({
				inventory,
				graph,
				usage,
				exportsAnalysis,
				unusedExportsReport,
			});

			const reportPath = join(repoOptions.rootDir, "serenity-now-summary.md");
			await deps.fileSystem.writeText(reportPath, report);
			console.log(`\n✅ Report generated: ${reportPath}\n`);
			return 0;
		}

		// Handle detect-unused-exports command
		if (args.command === "detect-unused-exports") {
			console.log("\n═══ Exports Analysis ═══\n");

			if (!exportsAnalysis) {
				console.log("No export analysis available\n");
				return 0;
			}

			// Build a map of used exports per project from import usage
			const usedExportsByProject = new Map<string, Set<string>>();

			for (const projectId of Object.keys(exportsAnalysis.projects)) {
				usedExportsByProject.set(projectId, new Set());
			}

			// Mark exports as used based on actual imports
			for (const usageRecord of Object.values(usage.usage)) {
				for (const usageDetail of usageRecord.usageDetails) {
					// Extract package name from specifier
					const packageName = usageDetail.specifier.startsWith("@")
						? usageDetail.specifier.split("/").slice(0, 2).join("/")
						: usageDetail.specifier.split("/")[0];

					const targetProject = Object.values(inventory.projects).find(
						(p) => p.packageJson.name === packageName,
					);

					if (targetProject && usageDetail.namedImports) {
						for (const namedImport of usageDetail.namedImports) {
							usedExportsByProject.get(targetProject.id)?.add(namedImport);
						}
					}
				}
			}

			// Group unused exports by project
			const unusedByProject = new Map<string, UnusedExport[]>();
			if (unusedExportsReport) {
				for (const unusedExport of unusedExportsReport.unusedExports) {
					if (!unusedByProject.has(unusedExport.projectId)) {
						unusedByProject.set(unusedExport.projectId, []);
					}
					unusedByProject.get(unusedExport.projectId)?.push(unusedExport);
				}
			}

			// Sort projects by number of total exports (descending)
			const sortedProjects = Object.entries(exportsAnalysis.projects)
				.filter(([_id, proj]) => proj.exports.length > 0)
				.sort((a, b) => b[1].exports.length - a[1].exports.length);

			for (const [projectId, projectExports] of sortedProjects) {
				const project = inventory.projects[projectId];
				const packageName = project?.packageJson.name || projectId;
				const usedExports = usedExportsByProject.get(projectId) || new Set();
				const unusedExports = unusedByProject.get(projectId) || [];
				const totalExports = projectExports.exports.length;

				// Check if this package has zero imports
				const hasAnyImports = usedExports.size > 0;

				console.log(`📦 ${packageName}`);

				// 🚨 Zero imports - likely abandoned
				if (!hasAnyImports && totalExports > 0) {
					console.log(`   🚨 ZERO IMPORTS - Package may be abandoned`);
					console.log(`   Total exports: ${totalExports}`);
					console.log();
					continue;
				}

				console.log(`   Total exports: ${totalExports}`);
				console.log(`   ✅ Used: ${usedExports.size}`);

				// Categorize unused exports
				const unusedNamedExports = unusedExports.filter((e) => !e.isReExport);
				const unusedReExports = unusedExports.filter((e) => e.isReExport);

				if (unusedNamedExports.length === 0 && unusedReExports.length === 0) {
					console.log(`   ✅ All exports are used!`);
					console.log();
					continue;
				}

				if (unusedNamedExports.length > 0) {
					console.log(
						`   ⚠️  Unused named exports (${unusedNamedExports.length}):`,
					);
					const toShow = unusedNamedExports.slice(0, 10);
					for (const exp of toShow) {
						console.log(`      - ${exp.exportName} (${exp.sourceFile})`);
					}
					if (unusedNamedExports.length > 10) {
						console.log(`      ... and ${unusedNamedExports.length - 10} more`);
					}
				}

				if (unusedReExports.length > 0) {
					console.log(
						`   📊 Unused re-exports: ${unusedReExports.length} (likely fine - API surface)`,
					);
				}

				if (usedExports.size > 0) {
					const usedList = Array.from(usedExports).slice(0, 10).join(", ");
					const more =
						usedExports.size > 10 ? ` +${usedExports.size - 10} more` : "";
					console.log(`   Used exports: ${usedList}${more}`);
				}

				console.log();
			}

			if (unusedExportsReport) {
				console.log(
					`Total: ${unusedExportsReport.unusedExports.length} unused export(s) across ${unusedByProject.size} package(s)\n`,
				);
			}

			return 0;
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

		// Report unused exports
		if (unusedExportsReport && unusedExportsReport.unusedExports.length > 0) {
			console.log("\n▶ Unused Exports");

			// Group by project
			const byProject = new Map<
				string,
				typeof unusedExportsReport.unusedExports
			>();
			for (const unusedExport of unusedExportsReport.unusedExports) {
				if (!byProject.has(unusedExport.projectId)) {
					byProject.set(unusedExport.projectId, []);
				}
				byProject.get(unusedExport.projectId)?.push(unusedExport);
			}

			// Categorize projects
			let packagesWithZeroImports = 0;

			for (const [projectId, exports] of byProject.entries()) {
				const unusedNamedExports = exports.filter((e) => !e.isReExport);
				const unusedReExports = exports.filter((e) => e.isReExport);

				// Check if package has zero imports
				const usageRecord = usage.usage[projectId];
				const hasImports =
					usageRecord &&
					(usageRecord.dependencies.length > 0 ||
						usageRecord.typeOnlyDependencies.length > 0);

				if (!hasImports && exports.length > 0) {
					packagesWithZeroImports++;
					console.log(`\n  🚨 ${projectId} - ZERO IMPORTS (may be abandoned)`);
					continue;
				}

				if (unusedNamedExports.length > 0) {
					console.log(
						`\n  📦 ${projectId} (${unusedNamedExports.length} unused named export${unusedNamedExports.length > 1 ? "s" : ""}):`,
					);
					for (const exp of unusedNamedExports.slice(0, 10)) {
						const typeLabel = exp.isTypeOnly ? "[type]" : "";
						const exportTypeLabel =
							exp.exportType === "default" ? "[default]" : "";
						console.log(
							`      ${exp.exportName} ${typeLabel}${exportTypeLabel} (${exp.sourceFile})`,
						);
					}
					if (unusedNamedExports.length > 10) {
						console.log(`      ... and ${unusedNamedExports.length - 10} more`);
					}

					if (unusedReExports.length > 0) {
						console.log(
							`      (+ ${unusedReExports.length} unused re-exports - likely fine)`,
						);
					}
				} else if (unusedReExports.length > 0) {
					console.log(
						`\n  📦 ${projectId}: ${unusedReExports.length} unused re-exports (likely fine - API surface)`,
					);
				}
			}

			const totalNamedUnused = unusedExportsReport.unusedExports.filter(
				(e) => !e.isReExport,
			).length;
			const totalReExports = unusedExportsReport.unusedExports.filter(
				(e) => e.isReExport,
			).length;

			console.log("\n  Summary:");
			if (packagesWithZeroImports > 0) {
				console.log(
					`    🚨 ${packagesWithZeroImports} package(s) with zero imports`,
				);
			}
			if (totalNamedUnused > 0) {
				console.log(
					`    ⚠️  ${totalNamedUnused} unused named export(s) across ${byProject.size} package(s)`,
				);
			}
			if (totalReExports > 0) {
				console.log(`    📊 ${totalReExports} unused re-exports (likely fine)`);
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
