import { describe, expect, test } from "vitest";
import type { EmitResult } from "../../../core/types.js";
import { formatSyncResult } from "./sync_summary.js";

const result: EmitResult = {
	fileChanges: [
		{
			projectId: "app",
			filePath: "/repo/apps/app/package.json",
			changes: [
				{ action: "add", description: 'dependencies["@x/ui"] = "workspace:*"' },
				{
					action: "remove",
					description: 'dependencies["@x/old"] (not imported)',
				},
				{ action: "update", description: "private = true (template)" },
			],
		},
	],
	skippedProjects: [
		{ projectId: "legacy", reason: "its sources were not scanned" },
	],
};

describe("formatSyncResult", () => {
	test("lists changes per file with relative paths", () => {
		const lines = formatSyncResult(result, "/repo", {
			dryRun: false,
			projectCount: 3,
		});
		expect(lines).toContain("app: apps/app/package.json");
		expect(lines).toContain('  + dependencies["@x/ui"] = "workspace:*"');
		expect(lines).toContain('  - dependencies["@x/old"] (not imported)');
		expect(lines).toContain("  ~ private = true (template)");
		expect(lines).toContain("Skipped (not modified): legacy");
	});

	// Scripts grep these lines, so their wording must not change.
	test("summary block after writing files", () => {
		const lines = formatSyncResult(result, "/repo", {
			dryRun: false,
			projectCount: 3,
		});
		expect(lines.slice(-5)).toEqual([
			"═══ Summary ═══",
			"  Projects scanned: 3",
			"  Files modified: 1",
			"",
			"✅ Updated 1 file(s).",
		]);
	});

	test("summary block for a dry run", () => {
		const lines = formatSyncResult(result, "/repo", {
			dryRun: true,
			projectCount: 3,
		});
		expect(lines.slice(-5)).toEqual([
			"═══ Summary ═══",
			"  Projects scanned: 3",
			"  Files to modify: 1",
			"",
			"✨ Dry run complete (no files modified).",
		]);
	});

	test("summary block when everything is in sync", () => {
		const empty: EmitResult = { fileChanges: [], skippedProjects: [] };
		expect(
			formatSyncResult(empty, "/repo", { dryRun: true, projectCount: 2 }),
		).toContain("  Files to modify: 0");
		const lines = formatSyncResult(empty, "/repo", {
			dryRun: false,
			projectCount: 2,
		});
		expect(lines.slice(-3)).toEqual([
			"  Files modified: 0",
			"",
			"✅ All dependencies are already in sync!",
		]);
		expect(lines.join("\n")).not.toContain("Skipped");
	});
});
