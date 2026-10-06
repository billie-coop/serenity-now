import { relative } from "node:path";
import {
	isBareSpecifier,
	packageNameFromSpecifier,
} from "../../core/package_name.js";
import type {
	LoggerPort,
	SourceAnalyzerOptions,
	SourceAnalyzerPort,
} from "../../core/ports.js";
import type {
	ExportRecord,
	ProjectInfo,
	ProjectInventory,
	ProjectScan,
	SourceAnalysis,
	SyncConfig,
	WorkspaceImport,
} from "../../core/types.js";
import { createMatcher } from "../glob/patterns.js";
import { resolveSourceEntryPoint } from "../typescript/entry_point.js";
import { collectExports } from "../typescript/exports.js";
import { collectModuleImports } from "../typescript/imports.js";
import {
	openTypeScriptSession,
	type ProjectSources,
} from "../typescript/session.js";

export function createSourceAnalyzer(): SourceAnalyzerPort {
	return {
		async analyze(
			inventory: ProjectInventory,
			config: SyncConfig,
			options: SourceAnalyzerOptions,
			logger: LoggerPort,
		): Promise<SourceAnalysis> {
			const session = openTypeScriptSession(inventory, config.excludePatterns);
			try {
				const isIgnoredImport = createMatcher(config.ignoreImports);
				const analysis: SourceAnalysis = {
					projects: {},
					entryPoints: {},
					composite: {},
				};

				for (const project of Object.values(inventory.projects)) {
					const sources = session.sources.get(project.id);
					analysis.projects[project.id] = scanProject(
						project,
						sources,
						inventory,
						isIgnoredImport,
					);
					analysis.entryPoints[project.id] = resolveSourceEntryPoint(
						project,
						sources?.units ?? [],
					);
					analysis.composite[project.id] =
						sources?.units.find((u) => u.configPath === project.tsconfigPath)
							?.project.compilerOptions.composite === true;
				}

				if (options.includeExports) {
					analysis.exports = scanExports(inventory, analysis, session.sources);
				}

				for (const [id, scan] of Object.entries(analysis.projects)) {
					if (scan.status !== "skipped") continue;
					const message = `${id} was not scanned and will not be modified: ${scan.reason}`;
					// Expected for projects configured as non-TypeScript; anything else is a surprise.
					const expected =
						!session.sources.has(id) &&
						!inventory.projects[id]?.workspaceConfig.requiresTsconfig;
					if (expected) {
						logger.debug(message);
					} else {
						logger.warn(message);
					}
				}
				const scanned = Object.values(analysis.projects).filter(
					(s) => s.status === "scanned",
				);
				logger.info(
					`→ Scanned ${scanned.reduce((n, s) => n + s.fileCount, 0)} files in ${scanned.length} projects`,
				);
				return analysis;
			} finally {
				session.close();
			}
		},
	};
}

function scanProject(
	project: ProjectInfo,
	sources: ProjectSources | undefined,
	inventory: ProjectInventory,
	isIgnoredImport: (specifier: string) => boolean,
): ProjectScan {
	if (!sources) {
		return { status: "skipped", reason: "it has no tsconfig.json files" };
	}
	if (sources.files.size === 0) {
		return {
			status: "skipped",
			reason: "its tsconfig files include no source files of its own",
		};
	}

	const imports: WorkspaceImport[] = [];
	for (const [file, unit] of sources.files) {
		const sourceFile = unit.project.program.getSourceFile(file);
		if (!sourceFile) continue;
		for (const imp of collectModuleImports(sourceFile)) {
			if (!isBareSpecifier(imp.specifier) || isIgnoredImport(imp.specifier)) {
				continue;
			}
			const dependencyId = packageNameFromSpecifier(imp.specifier);
			if (!inventory.projects[dependencyId]) continue;
			imports.push({
				dependencyId,
				specifier: imp.specifier,
				sourceFile: relative(project.root, file).replaceAll("\\", "/"),
				isTypeOnly: imp.isTypeOnly,
				bindings: imp.bindings,
			});
		}
	}
	return { status: "scanned", fileCount: sources.files.size, imports };
}

function scanExports(
	inventory: ProjectInventory,
	analysis: SourceAnalysis,
	sources: Map<string, ProjectSources>,
): Record<string, ExportRecord[]> {
	const exports: Record<string, ExportRecord[]> = {};
	for (const project of Object.values(inventory.projects)) {
		const entry = analysis.entryPoints[project.id];
		if (
			project.workspaceType !== "shared-package" ||
			entry?.status !== "resolved"
		) {
			continue;
		}
		const entryFile = `${project.root}/${entry.path}`;
		const unit = sources.get(project.id)?.files.get(entryFile);
		exports[project.id] = unit ? collectExports(unit, entryFile) : [];
	}
	return exports;
}
