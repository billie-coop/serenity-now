import type { ResolvedGraph } from "../../../core/types.js";
import {
	actionableDiamonds,
	dependents,
	listWithMore,
	universalDiamondCounts,
} from "./graph_stats.js";

export function formatHealthReport(graph: ResolvedGraph): string[] {
	const lines: string[] = [];

	if (graph.cycles.length > 0) {
		lines.push(`Circular dependencies (${graph.cycles.length}):`);
		for (const cycle of graph.cycles) {
			lines.push(`  - ${cycle.path.join(" → ")}`);
		}
	} else {
		lines.push("✓ No circular dependencies");
	}
	lines.push("");

	const diamonds = actionableDiamonds(graph);
	const total = diamonds.reduce((n, [, list]) => n + list.length, 0);
	lines.push(
		total > 0
			? `Diamond dependencies (${total}, excluding universal utilities):`
			: "✓ No diamond dependencies (excluding universal utilities)",
	);
	for (const [pkg, occurrences] of diamonds.slice(0, 10)) {
		lines.push(`  ${pkg} (${occurrences.length}):`);
		for (const d of occurrences.slice(0, 3)) {
			lines.push(
				`    - ${d.projectId}: direct and via ${listWithMore(d.transitiveThrough, 3)}`,
			);
		}
		if (occurrences.length > 3) {
			lines.push(`    … and ${occurrences.length - 3} more`);
		}
	}
	if (diamonds.length > 10) {
		lines.push(`  … and ${diamonds.length - 10} more packages`);
	}
	for (const [pkg, count] of universalDiamondCounts(graph)) {
		lines.push(`  ${pkg}: ${count} (universal utility, expected)`);
	}
	lines.push("");

	const usedBy = dependents(graph);
	const unused = Object.values(graph.projects)
		.filter(
			(p) =>
				p.project.workspaceType === "shared-package" &&
				(usedBy.get(p.project.id)?.length ?? 0) === 0,
		)
		.map((p) => p.project.id)
		.sort();
	lines.push(
		unused.length > 0
			? `Shared packages no project depends on (${unused.length}): ${unused.join(", ")}`
			: "✓ Every shared package is used",
	);

	const mostUsed = [...usedBy]
		.filter(([, list]) => list.length > 0)
		.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
		.slice(0, 5);
	if (mostUsed.length > 0) {
		lines.push("", "Most depended-upon packages:");
		for (const [id, list] of mostUsed) {
			lines.push(`  - ${id}: ${list.length} project(s)`);
		}
	}

	const notScanned = Object.values(graph.projects)
		.filter((p) => !p.scanned)
		.map((p) => p.project.id);
	if (notScanned.length > 0) {
		lines.push(
			"",
			`Not scanned (left untouched by sync): ${notScanned.join(", ")}`,
		);
	}
	return lines;
}
