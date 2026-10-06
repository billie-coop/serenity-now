import type {
	PackageExportUsage,
	ProjectInventory,
	SourceAnalysis,
} from "./types.js";

/**
 * Cross-references each shared package's exports with the imports found
 * across the workspace.
 */
export function analyzeExportUsage(
	inventory: ProjectInventory,
	analysis: SourceAnalysis,
): PackageExportUsage[] {
	const importedBy = new Map<string, Set<string>>();
	const usedNames = new Map<string, Set<string>>();
	const usedWholesale = new Set<string>();

	for (const [importerId, scan] of Object.entries(analysis.projects)) {
		if (scan.status !== "scanned") continue;
		for (const imp of scan.imports) {
			const target = imp.dependencyId;
			if (target !== importerId) {
				getOrCreate(importedBy, target).add(importerId);
			}
			if (imp.bindings.kind === "namespace") {
				usedWholesale.add(target);
			} else if (imp.bindings.kind === "named") {
				const names = getOrCreate(usedNames, target);
				for (const name of imp.bindings.names) names.add(name);
			}
		}
	}

	const results: PackageExportUsage[] = [];
	for (const [projectId, exports] of Object.entries(analysis.exports ?? {})) {
		if (!inventory.projects[projectId]) continue;
		const wholesale = usedWholesale.has(projectId);
		const names = usedNames.get(projectId) ?? new Set<string>();

		results.push({
			projectId,
			importedBy: [...(importedBy.get(projectId) ?? [])].sort(),
			usedWholesale: wholesale,
			usedExports: exports
				.filter((e) => wholesale || names.has(e.exportName))
				.map((e) => e.exportName),
			unusedExports: wholesale
				? []
				: exports.filter((e) => !names.has(e.exportName)),
			totalExports: exports.length,
		});
	}

	return results.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function getOrCreate<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
	let set = map.get(key);
	if (!set) {
		set = new Set();
		map.set(key, set);
	}
	return set;
}
