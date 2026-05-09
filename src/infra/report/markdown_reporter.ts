import type {
	ExportAnalysis,
	ProjectInventory,
	ProjectUsage,
	ResolvedGraph,
	UnusedExportsReport,
} from "../../core/types.js";

export interface MarkdownReportData {
	inventory: ProjectInventory;
	graph: ResolvedGraph;
	usage: ProjectUsage;
	exportsAnalysis?: ExportAnalysis;
	unusedExportsReport?: UnusedExportsReport;
}

/**
 * Generates a comprehensive markdown report for LLM consumption
 */
export function generateMarkdownReport(data: MarkdownReportData): string {
	const sections: string[] = [];

	// Header
	sections.push("# Serenity Now - Monorepo Analysis Report\n");
	sections.push(`Generated: ${new Date().toISOString()}\n`);
	sections.push(
		`Total Projects: ${Object.keys(data.inventory.projects).length}\n`,
	);

	// Circular Dependencies
	if (data.graph.cycles.length > 0) {
		sections.push("## 🔴 Circular Dependencies\n");
		sections.push(
			"Circular dependencies prevent proper incremental compilation and can cause runtime issues.\n",
		);
		for (const cycle of data.graph.cycles) {
			sections.push(`- ${cycle.path.join(" → ")}\n`);
		}
		sections.push("");
	}

	// Diamond Dependencies
	if (data.graph.diamonds.length > 0) {
		sections.push("## 💎 Diamond Dependencies\n");
		sections.push(
			"Diamond dependencies occur when a package is reached through multiple paths. This can indicate:\n",
		);
		sections.push("- Overly coupled architecture\n");
		sections.push("- Opportunities to consolidate dependencies\n");
		sections.push(
			"- Potential for version conflicts if using different versions\n",
		);
		sections.push("");

		// Group by project
		const diamondsByProject = new Map<string, typeof data.graph.diamonds>();
		for (const diamond of data.graph.diamonds) {
			if (!diamondsByProject.has(diamond.projectId)) {
				diamondsByProject.set(diamond.projectId, []);
			}
			diamondsByProject.get(diamond.projectId)?.push(diamond);
		}

		for (const [projectId, diamonds] of diamondsByProject.entries()) {
			const project = data.inventory.projects[projectId];
			const packageName = project?.packageJson.name || projectId;
			sections.push(`### ${packageName}\n`);
			for (const diamond of diamonds) {
				sections.push(`- **${diamond.directDependency}**\n`);
				sections.push(
					`  - Also reached via: ${diamond.transitiveThrough.join(", ")}\n`,
				);
			}
			sections.push("");
		}
	}

	// Export Analysis
	if (data.exportsAnalysis && data.unusedExportsReport) {
		sections.push("## 📦 Export Analysis\n");
		sections.push(
			"This section shows which exports are actually used vs unused in your monorepo.\n",
		);
		sections.push("");

		// Build used exports map
		const usedExportsByProject = new Map<string, Set<string>>();
		for (const projectId of Object.keys(data.exportsAnalysis.projects)) {
			usedExportsByProject.set(projectId, new Set());
		}

		for (const usageRecord of Object.values(data.usage.usage)) {
			for (const usageDetail of usageRecord.usageDetails) {
				const packageName = usageDetail.specifier.startsWith("@")
					? usageDetail.specifier.split("/").slice(0, 2).join("/")
					: usageDetail.specifier.split("/")[0];

				const targetProject = Object.values(data.inventory.projects).find(
					(p) => p.packageJson.name === packageName,
				);

				if (targetProject && usageDetail.namedImports) {
					for (const namedImport of usageDetail.namedImports) {
						usedExportsByProject.get(targetProject.id)?.add(namedImport);
					}
				}
			}
		}

		// Group unused by project
		const unusedByProject = new Map<
			string,
			typeof data.unusedExportsReport.unusedExports
		>();
		for (const unusedExport of data.unusedExportsReport.unusedExports) {
			if (!unusedByProject.has(unusedExport.projectId)) {
				unusedByProject.set(unusedExport.projectId, []);
			}
			unusedByProject.get(unusedExport.projectId)?.push(unusedExport);
		}

		// Sort by most unused
		const sortedProjects = Object.entries(data.exportsAnalysis.projects)
			.filter(([_id, proj]) => proj.exports.length > 0)
			.sort((a, b) => {
				const aUnused = unusedByProject.get(a[0])?.length || 0;
				const bUnused = unusedByProject.get(b[0])?.length || 0;
				return bUnused - aUnused;
			});

		for (const [projectId, projectExports] of sortedProjects) {
			const project = data.inventory.projects[projectId];
			const packageName = project?.packageJson.name || projectId;
			const usedExports = usedExportsByProject.get(projectId) || new Set();
			const unusedExports = unusedByProject.get(projectId) || [];

			// Check if this package has zero imports
			const hasAnyImports = usedExports.size > 0;

			sections.push(`### ${packageName}\n`);

			// 🚨 Zero imports - likely abandoned
			if (!hasAnyImports && projectExports.exports.length > 0) {
				sections.push(`🚨 **ZERO IMPORTS - Package may be abandoned**\n`);
				sections.push(
					`- **Total exports:** ${projectExports.exports.length}\n`,
				);
				sections.push("");
				continue;
			}

			sections.push(`- **Total exports:** ${projectExports.exports.length}\n`);
			sections.push(`- **Used:** ${usedExports.size}\n`);

			// Categorize unused exports by type
			const unusedNamedExports = unusedExports.filter((e) => !e.isReExport);
			const unusedReExports = unusedExports.filter((e) => e.isReExport);

			if (unusedNamedExports.length === 0 && unusedReExports.length === 0) {
				sections.push(`- ✅ **All exports are used!**\n`);
				sections.push("");
				continue;
			}

			// Show unused named exports (medium signal)
			if (unusedNamedExports.length > 0) {
				sections.push(
					`- ⚠️  **Unused named exports:** ${unusedNamedExports.length}\n`,
				);
			}

			// Show count of unused re-exports (low signal)
			if (unusedReExports.length > 0) {
				sections.push(
					`- 📊 **Unused re-exports:** ${unusedReExports.length} (likely fine - API surface)\n`,
				);
			}

			sections.push("");

			if (usedExports.size > 0) {
				sections.push("**Used Exports:**\n");
				sections.push("```\n");
				sections.push(Array.from(usedExports).sort().join(", "));
				sections.push("\n```\n");
				sections.push("");
			}

			// Only list unused NAMED exports (not re-exports)
			if (unusedNamedExports.length > 0) {
				sections.push("**Unused Named Exports (review these):**\n");
				sections.push("```\n");
				sections.push(
					unusedNamedExports
						.map((e) => `${e.exportName} (${e.sourceFile})`)
						.sort()
						.join("\n"),
				);
				sections.push("\n```\n");
				sections.push("");
			}

			// Generate example entry point
			if (
				usedExports.size > 0 &&
				usedExports.size < projectExports.exports.length
			) {
				sections.push("**Example Entry Point (src/index.ts):**\n");
				sections.push("```typescript\n");
				sections.push("// Only export what's actually used\n");

				// Group by type-only vs regular
				const typeOnlyExports: string[] = [];
				const regularExports: string[] = [];

				for (const exportName of Array.from(usedExports).sort()) {
					const exportRecord = projectExports.exports.find(
						(e) => e.exportName === exportName,
					);
					if (exportRecord?.isTypeOnly) {
						typeOnlyExports.push(exportName);
					} else {
						regularExports.push(exportName);
					}
				}

				if (typeOnlyExports.length > 0) {
					sections.push("export type {\n");
					for (const exp of typeOnlyExports) {
						sections.push(`  ${exp},\n`);
					}
					sections.push("} from './...'; // Update path as needed\n");
					sections.push("\n");
				}

				if (regularExports.length > 0) {
					sections.push("export {\n");
					for (const exp of regularExports) {
						sections.push(`  ${exp},\n`);
					}
					sections.push("} from './...'; // Update path as needed\n");
				}

				sections.push("```\n");
				sections.push("");
			}
		}
	}

	return sections.join("");
}
