import type {
	PackageExportUsage,
	ProjectInventory,
	SourceAnalysis,
} from "../../../core/types.js";

/** Packages whose exports couldn't be analyzed, with the reason. */
export function unanalyzedPackages(
	inventory: ProjectInventory,
	analysis: SourceAnalysis,
): Array<[string, string]> {
	return Object.values(inventory.projects)
		.filter((p) => p.workspaceType === "shared-package")
		.flatMap((p): Array<[string, string]> => {
			const entry = analysis.entryPoints[p.id];
			return entry?.status === "unresolved" ? [[p.id, entry.reason]] : [];
		});
}

export function formatUnusedExports(
	usages: PackageExportUsage[],
	unanalyzed: Array<[string, string]>,
	options: { verbose: boolean },
): string[] {
	const lines: string[] = [];
	const limit = options.verbose ? Number.POSITIVE_INFINITY : 10;
	let unusedNamed = 0;
	let notImported = 0;

	for (const usage of usages) {
		lines.push(`📦 ${usage.projectId}`);
		if (usage.importedBy.length === 0) {
			notImported++;
			lines.push(
				`   🚨 Not imported by any other workspace project (${usage.totalExports} exports)`,
				"",
			);
			continue;
		}
		lines.push(
			`   Imported by ${usage.importedBy.length} project(s); ${usage.usedExports.length}/${usage.totalExports} exports used`,
		);
		if (usage.usedWholesale) {
			lines.push(
				"   Imported wholesale (namespace import, export * or dynamic import), so every export counts as used",
			);
		}
		const named = usage.unusedExports.filter((e) => !e.isReExport);
		const reExports = usage.unusedExports.filter((e) => e.isReExport);
		unusedNamed += named.length;
		if (named.length > 0) {
			lines.push(`   ⚠️  Unused exports (${named.length}):`);
			for (const exp of named.slice(0, limit)) {
				const tag = exp.isTypeOnly
					? " [type]"
					: exp.exportType === "default"
						? " [default]"
						: "";
				lines.push(`      - ${exp.exportName}${tag}`);
			}
			if (named.length > limit) {
				lines.push(`      … and ${named.length - limit} more (use --verbose)`);
			}
		}
		if (reExports.length > 0) {
			lines.push(`   Unused via export * (${reExports.length})`);
		}
		if (usage.unusedExports.length === 0) {
			lines.push("   ✅ All exports are used");
		}
		lines.push("");
	}

	for (const [id, reason] of unanalyzed) {
		lines.push(`⚠ ${id}: exports not analyzed (${reason})`);
	}
	lines.push(
		`Summary: ${unusedNamed} unused export(s), ${notImported} package(s) not imported anywhere`,
	);
	return lines;
}
