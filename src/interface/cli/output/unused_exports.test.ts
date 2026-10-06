import { describe, expect, test } from "vitest";
import type { ExportRecord, PackageExportUsage } from "../../../core/types.js";
import {
	makeAnalysis,
	makeInventory,
	makeProject,
} from "../../../test_support/builders.js";
import { formatUnusedExports, unanalyzedPackages } from "./unused_exports.js";

const exp = (
	exportName: string,
	extra: Partial<ExportRecord> = {},
): ExportRecord => ({
	exportName,
	isTypeOnly: false,
	exportType: "named",
	isReExport: false,
	...extra,
});

const usage = (overrides: Partial<PackageExportUsage>): PackageExportUsage => ({
	projectId: "@x/ui",
	importedBy: ["app"],
	usedWholesale: false,
	usedExports: [],
	unusedExports: [],
	totalExports: 0,
	...overrides,
});

describe("unanalyzedPackages", () => {
	test("lists shared packages with unresolved entry points", () => {
		const inventory = makeInventory([
			makeProject("app", { relativeRoot: "apps/app", workspaceType: "app" }),
			makeProject("@x/ui"),
			makeProject("@x/ok"),
		]);
		const analysis = makeAnalysis(
			inventory,
			{},
			{
				entryPoints: {
					app: { status: "unresolved", reason: "apps don't count" },
					"@x/ui": { status: "unresolved", reason: "no exports" },
				},
			},
		);
		expect(unanalyzedPackages(inventory, analysis)).toEqual([
			["@x/ui", "no exports"],
		]);
	});
});

describe("formatUnusedExports", () => {
	test("reports unused exports, re-exports and packages nobody imports", () => {
		const text = formatUnusedExports(
			[
				usage({
					usedExports: ["Button"],
					unusedExports: [
						exp("Card"),
						exp("Props", { isTypeOnly: true }),
						exp("default", { exportType: "default" }),
						exp("Deep", { isReExport: true }),
					],
					totalExports: 5,
				}),
				usage({ projectId: "@x/orphan", importedBy: [], totalExports: 2 }),
				usage({
					projectId: "@x/all",
					usedWholesale: true,
					usedExports: ["a"],
					totalExports: 1,
				}),
			],
			[["@x/broken", "no exports"]],
			{ verbose: false },
		).join("\n");

		expect(text).toContain("Imported by 1 project(s); 1/5 exports used");
		expect(text).toContain("⚠️  Unused exports (3):");
		expect(text).toContain("      - Card");
		expect(text).toContain("      - Props [type]");
		expect(text).toContain("      - default [default]");
		expect(text).toContain("Unused via export * (1)");
		expect(text).toContain(
			"🚨 Not imported by any other workspace project (2 exports)",
		);
		expect(text).toContain("Imported wholesale");
		expect(text).toContain("✅ All exports are used");
		expect(text).toContain("⚠ @x/broken: exports not analyzed (no exports)");
		expect(text).toContain(
			"Summary: 3 unused export(s), 1 package(s) not imported anywhere",
		);
	});

	test("truncates long lists unless verbose", () => {
		const many = Array.from({ length: 12 }, (_, i) => exp(`e${i}`));
		const short = formatUnusedExports([usage({ unusedExports: many })], [], {
			verbose: false,
		});
		expect(short).toContain("      … and 2 more (use --verbose)");
		const full = formatUnusedExports([usage({ unusedExports: many })], [], {
			verbose: true,
		});
		expect(full).toContain("      - e11");
		expect(full.join("\n")).not.toContain("more (use --verbose)");
	});
});
