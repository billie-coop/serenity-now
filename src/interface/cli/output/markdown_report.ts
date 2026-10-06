import type {
	PackageExportUsage,
	ProjectInventory,
	ResolvedGraph,
} from "../../../core/types.js";
import { actionableDiamonds, universalDiamondCounts } from "./graph_stats.js";

export interface MarkdownReportData {
	inventory: ProjectInventory;
	graph: ResolvedGraph;
	exportUsage: PackageExportUsage[];
	unanalyzed: Array<[string, string]>;
	generatedAt: Date;
}

/** A full analysis of the monorepo as Markdown (meant to be handed to an LLM or a human). */
export function formatMarkdownReport(data: MarkdownReportData): string {
	const out: string[] = [
		"# Serenity Now - Monorepo Analysis Report",
		"",
		`Generated: ${data.generatedAt.toISOString()}`,
		"",
		`Total projects: ${Object.keys(data.inventory.projects).length}`,
		"",
	];

	if (data.graph.cycles.length > 0) {
		out.push(
			"## 🔴 Circular Dependencies",
			"",
			"Circular dependencies break incremental TypeScript builds (project references can't form a cycle).",
			"",
			...data.graph.cycles.map((c) => `- ${c.path.join(" → ")}`),
			"",
		);
	}

	const diamonds = actionableDiamonds(data.graph);
	const universal = universalDiamondCounts(data.graph);
	if (diamonds.length > 0 || universal.length > 0) {
		out.push(
			"## 💎 Diamond Dependencies",
			"",
			"A project imports a package directly and also through another dependency. This can mean the intermediate package is an incomplete abstraction.",
			"",
		);
		for (const [pkg, occurrences] of diamonds) {
			out.push(`### ${pkg}`, "");
			for (const d of occurrences) {
				out.push(
					`- ${d.projectId} (also via ${d.transitiveThrough.join(", ")})`,
				);
			}
			out.push("");
		}
		for (const [pkg, count] of universal) {
			out.push(
				`- ${pkg}: ${count} occurrence(s), expected (universal utility)`,
			);
		}
		if (universal.length > 0) out.push("");
	}

	if (data.exportUsage.length > 0 || data.unanalyzed.length > 0) {
		out.push("## 📦 Export Usage", "");
		for (const usage of data.exportUsage) {
			out.push(...formatPackageExports(usage));
		}
		for (const [id, reason] of data.unanalyzed) {
			out.push(`### ${id}`, "", `Exports not analyzed: ${reason}`, "");
		}
	}

	return `${out.join("\n")}\n`;
}

function formatPackageExports(usage: PackageExportUsage): string[] {
	const out = [`### ${usage.projectId}`, ""];
	if (usage.importedBy.length === 0) {
		out.push(
			`🚨 **Not imported by any other workspace project** (${usage.totalExports} exports)`,
			"",
		);
		return out;
	}
	out.push(
		`- **Imported by:** ${usage.importedBy.join(", ")}`,
		`- **Exports used:** ${usage.usedExports.length}/${usage.totalExports}`,
	);
	if (usage.usedWholesale) {
		out.push("- Imported wholesale, so every export counts as used");
	}
	const named = usage.unusedExports.filter((e) => !e.isReExport);
	const reExports = usage.unusedExports.filter((e) => e.isReExport);
	if (reExports.length > 0) {
		out.push(`- **Unused via export \\*:** ${reExports.length}`);
	}
	out.push("");
	if (named.length > 0) {
		out.push(
			"**Unused exports (review these):**",
			"",
			"```",
			...named.map((e) => e.exportName).sort(),
			"```",
			"",
		);
	}
	return out;
}
