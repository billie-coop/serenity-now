import { relative } from "node:path";
import type { EmitResult } from "../../../core/types.js";

const SYMBOLS = { add: "+", remove: "-", update: "~" } as const;

/**
 * Per-file changes, then the summary block. The summary lines keep the exact
 * wording of earlier versions because scripts grep them (e.g. for
 * "Files to modify: 0").
 */
export function formatSyncResult(
	result: EmitResult,
	rootDir: string,
	mode: { dryRun: boolean; projectCount: number },
): string[] {
	const lines: string[] = [];
	for (const file of result.fileChanges) {
		lines.push(`${file.projectId}: ${relative(rootDir, file.filePath)}`);
		for (const change of file.changes) {
			lines.push(`  ${SYMBOLS[change.action]} ${change.description}`);
		}
	}
	if (result.skippedProjects.length > 0) {
		lines.push(
			"",
			`Skipped (not modified): ${result.skippedProjects.map((s) => s.projectId).join(", ")}`,
		);
	}

	const count = result.fileChanges.length;
	lines.push("", "═══ Summary ═══", `  Projects scanned: ${mode.projectCount}`);
	if (mode.dryRun) {
		lines.push(
			`  Files to modify: ${count}`,
			"",
			"✨ Dry run complete (no files modified).",
		);
	} else if (count > 0) {
		lines.push(
			`  Files modified: ${count}`,
			"",
			`✅ Updated ${count} file(s).`,
		);
	} else {
		lines.push(
			"  Files modified: 0",
			"",
			"✅ All dependencies are already in sync!",
		);
	}
	return lines;
}
