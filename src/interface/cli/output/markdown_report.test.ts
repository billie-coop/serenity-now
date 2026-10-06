import { describe, expect, test } from "vitest";
import {
	makeGraph,
	makeInventory,
	makeProject,
} from "../../../test_support/builders.js";
import { formatMarkdownReport } from "./markdown_report.js";

const inventory = makeInventory([
	makeProject("app", { relativeRoot: "apps/app", workspaceType: "app" }),
	makeProject("ui"),
	makeProject("utils"),
]);
const generatedAt = new Date("2026-01-02T03:04:05.000Z");

describe("formatMarkdownReport", () => {
	test("includes every section with data", () => {
		const graph = makeGraph(
			inventory,
			{ app: ["ui", "utils"], ui: ["utils"] },
			{
				cycles: [{ path: ["ui", "utils", "ui"] }],
				diamonds: [
					{
						projectId: "app",
						directDependency: "utils",
						transitiveThrough: ["ui"],
						pattern: "incomplete-abstraction",
					},
					{
						projectId: "app",
						directDependency: "ui",
						transitiveThrough: ["x"],
						pattern: "universal-utility",
					},
				],
			},
		);
		const md = formatMarkdownReport({
			inventory,
			graph,
			exportUsage: [
				{
					projectId: "ui",
					importedBy: ["app"],
					usedWholesale: false,
					usedExports: ["Button"],
					unusedExports: [
						{
							exportName: "Zeta",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "Alpha",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "Deep",
							isTypeOnly: false,
							exportType: "named",
							isReExport: true,
						},
					],
					totalExports: 4,
				},
				{
					projectId: "utils",
					importedBy: [],
					usedWholesale: false,
					usedExports: [],
					unusedExports: [],
					totalExports: 2,
				},
			],
			unanalyzed: [["broken", "no entry point"]],
			generatedAt,
		});

		expect(md).toContain("# Serenity Now - Monorepo Analysis Report");
		expect(md).toContain("Generated: 2026-01-02T03:04:05.000Z");
		expect(md).toContain("Total projects: 3");
		expect(md).toContain("## 🔴 Circular Dependencies");
		expect(md).toContain("- ui → utils → ui");
		expect(md).toContain("## 💎 Diamond Dependencies");
		expect(md).toContain("- app (also via ui)");
		expect(md).toContain("- ui: 1 occurrence(s), expected (universal utility)");
		expect(md).toContain("## 📦 Export Usage");
		expect(md).toContain("- **Imported by:** app");
		expect(md).toContain("- **Exports used:** 1/4");
		expect(md).toContain("- **Unused via export \\*:** 1");
		expect(md).toContain("```\nAlpha\nZeta\n```");
		expect(md).toContain(
			"🚨 **Not imported by any other workspace project** (2 exports)",
		);
		expect(md).toContain("Exports not analyzed: no entry point");
		expect(md.endsWith("\n")).toBe(true);
	});

	test("omits empty sections", () => {
		const md = formatMarkdownReport({
			inventory,
			graph: makeGraph(inventory, {}),
			exportUsage: [],
			unanalyzed: [],
			generatedAt,
		});
		expect(md).not.toContain("##");
	});
});
