import { describe, expect, test } from "vitest";
import {
	makeAnalysis,
	makeImport,
	makeInventory,
	makeProject,
} from "../test_support/builders.js";
import type { ExportRecord } from "./types.js";
import { analyzeExportUsage } from "./unused_exports.js";

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

const inventory = makeInventory([
	makeProject("app", { relativeRoot: "apps/app", workspaceType: "app" }),
	makeProject("web", { relativeRoot: "apps/web", workspaceType: "app" }),
	makeProject("@x/ui"),
]);
const uiExports = {
	"@x/ui": [exp("Button"), exp("Card"), exp("Props", { isTypeOnly: true })],
};

describe("analyzeExportUsage", () => {
	test("splits exports into used and unused by named imports", () => {
		const analysis = makeAnalysis(
			inventory,
			{
				app: [
					makeImport("@x/ui", {
						bindings: { kind: "named", names: ["Button"] },
					}),
				],
				web: [
					makeImport("@x/ui", {
						bindings: { kind: "named", names: ["Props", "Missing"] },
					}),
				],
			},
			{ exports: uiExports },
		);

		const [usage] = analyzeExportUsage(inventory, analysis);
		expect(usage).toEqual({
			projectId: "@x/ui",
			importedBy: ["app", "web"],
			usedWholesale: false,
			usedExports: ["Button", "Props"],
			unusedExports: [exp("Card")],
			totalExports: 3,
		});
	});

	test("a namespace import marks every export used", () => {
		const analysis = makeAnalysis(
			inventory,
			{ app: [makeImport("@x/ui", { bindings: { kind: "namespace" } })] },
			{ exports: uiExports },
		);
		const [usage] = analyzeExportUsage(inventory, analysis);
		expect(usage?.usedWholesale).toBe(true);
		expect(usage?.usedExports).toEqual(["Button", "Card", "Props"]);
		expect(usage?.unusedExports).toEqual([]);
	});

	test("a side-effect import counts as an importer but uses no exports", () => {
		const analysis = makeAnalysis(
			inventory,
			{ app: [makeImport("@x/ui", { bindings: { kind: "side-effect" } })] },
			{ exports: uiExports },
		);
		const [usage] = analyzeExportUsage(inventory, analysis);
		expect(usage?.importedBy).toEqual(["app"]);
		expect(usage?.usedExports).toEqual([]);
		expect(usage?.unusedExports).toHaveLength(3);
	});

	test("self-imports mark names used but don't count as importers", () => {
		const analysis = makeAnalysis(
			inventory,
			{
				"@x/ui": [
					makeImport("@x/ui", { bindings: { kind: "named", names: ["Card"] } }),
				],
			},
			{ exports: uiExports },
		);
		const [usage] = analyzeExportUsage(inventory, analysis);
		expect(usage?.importedBy).toEqual([]);
		expect(usage?.usedExports).toEqual(["Card"]);
	});

	test("skips unscanned importers and returns nothing without export data", () => {
		const skipped = makeAnalysis(
			inventory,
			{ app: ["@x/ui"] },
			{
				projects: { app: { status: "skipped", reason: "no tsconfig" } },
				exports: uiExports,
			},
		);
		expect(analyzeExportUsage(inventory, skipped)[0]?.importedBy).toEqual([]);
		expect(analyzeExportUsage(inventory, makeAnalysis(inventory))).toEqual([]);
	});

	test("results are sorted by package id", () => {
		const inv = makeInventory([makeProject("b"), makeProject("a")]);
		const analysis = makeAnalysis(inv, {}, { exports: { b: [], a: [] } });
		expect(analyzeExportUsage(inv, analysis).map((u) => u.projectId)).toEqual([
			"a",
			"b",
		]);
	});
});
