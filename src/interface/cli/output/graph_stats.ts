import type { DiamondPattern, ResolvedGraph } from "../../../core/types.js";

/** Projects that depend on each workspace package, keyed by package id. */
export function dependents(graph: ResolvedGraph): Map<string, string[]> {
	const result = new Map<string, string[]>(
		Object.keys(graph.projects).map((id) => [id, []]),
	);
	for (const [id, project] of Object.entries(graph.projects)) {
		for (const depId of Object.keys(project.dependencies)) {
			result.get(depId)?.push(id);
		}
	}
	return result;
}

/** Incomplete-abstraction diamonds grouped by the package reached twice, most frequent first. */
export function actionableDiamonds(
	graph: ResolvedGraph,
): Array<[string, DiamondPattern[]]> {
	const byPackage = new Map<string, DiamondPattern[]>();
	for (const diamond of graph.diamonds) {
		if (diamond.pattern !== "incomplete-abstraction") continue;
		const list = byPackage.get(diamond.directDependency) ?? [];
		list.push(diamond);
		byPackage.set(diamond.directDependency, list);
	}
	return [...byPackage].sort(
		(a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
	);
}

export function universalDiamondCounts(
	graph: ResolvedGraph,
): Array<[string, number]> {
	const counts = new Map<string, number>();
	for (const diamond of graph.diamonds) {
		if (diamond.pattern !== "universal-utility") continue;
		counts.set(
			diamond.directDependency,
			(counts.get(diamond.directDependency) ?? 0) + 1,
		);
	}
	return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
}

export function listWithMore(items: string[], limit: number): string {
	return items.length > limit
		? `${items.slice(0, limit).join(", ")}, … (+${items.length - limit})`
		: items.join(", ");
}
