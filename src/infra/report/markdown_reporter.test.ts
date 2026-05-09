import { describe, expect, it } from "vitest";
import type {
	ExportAnalysis,
	ProjectInventory,
	ProjectUsage,
	ResolvedGraph,
	UnusedExportsReport,
} from "../../core/types.js";
import { generateMarkdownReport } from "./markdown_reporter.js";

describe("Markdown Reporter", () => {
	it("generates basic report with project count", () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": {
					id: "lib-1",
					root: "/fake/lib-1",
					relativeRoot: "packages/lib-1",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: "/fake/lib-1/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const usage: ProjectUsage = {
			usage: {},
			warnings: [],
		};

		const report = generateMarkdownReport({
			inventory,
			graph,
			usage,
		});

		expect(report).toContain("# Serenity Now - Monorepo Analysis Report");
		expect(report).toContain("Total Projects: 1");
	});

	it("includes circular dependencies section", () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": {
					id: "lib-1",
					root: "/fake/lib-1",
					relativeRoot: "packages/lib-1",
					packageJson: { name: "@repo/lib-1" },
					tsconfigPath: "/fake/lib-1/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
				"lib-2": {
					id: "lib-2",
					root: "/fake/lib-2",
					relativeRoot: "packages/lib-2",
					packageJson: { name: "@repo/lib-2" },
					tsconfigPath: "/fake/lib-2/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {},
			cycles: [
				{
					path: ["@repo/lib-1", "@repo/lib-2", "@repo/lib-1"],
					projects: [],
				},
			],
			diamonds: [],
			warnings: [],
		};

		const usage: ProjectUsage = {
			usage: {},
			warnings: [],
		};

		const report = generateMarkdownReport({
			inventory,
			graph,
			usage,
		});

		expect(report).toContain("## 🔴 Circular Dependencies");
		expect(report).toContain("@repo/lib-1 → @repo/lib-2 → @repo/lib-1");
	});

	it("includes diamond dependencies section", () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": {
					id: "lib-1",
					root: "/fake/lib-1",
					relativeRoot: "packages/lib-1",
					packageJson: { name: "@repo/lib-1" },
					tsconfigPath: "/fake/lib-1/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [
				{
					projectId: "app-1",
					directDependency: "@repo/lib-1",
					transitiveThrough: ["@repo/lib-2", "@repo/lib-3"],
					pattern: "universal-utility",
					suggestion:
						"Consider if this dependency should be direct or transitive",
				},
			],
			warnings: [],
		};

		const usage: ProjectUsage = {
			usage: {},
			warnings: [],
		};

		const report = generateMarkdownReport({
			inventory,
			graph,
			usage,
		});

		expect(report).toContain("## 💎 Diamond Dependencies");
		expect(report).toContain("**@repo/lib-1**");
		expect(report).toContain("@repo/lib-2, @repo/lib-3");
	});

	it("includes export analysis section", () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": {
					id: "lib-1",
					root: "/fake/lib-1",
					relativeRoot: "packages/lib-1",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: "/fake/lib-1/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const exportsAnalysis: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "usedExport",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "unusedExport",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
					],
				},
			},
			warnings: [],
		};

		const usage: ProjectUsage = {
			usage: {
				"app-1": {
					dependencies: ["@repo/lib"],
					typeOnlyDependencies: [],
					usageDetails: [
						{
							dependencyId: "@repo/lib",
							specifier: "@repo/lib",
							isTypeOnly: false,
							sourceFile: "src/index.ts",
							namedImports: ["usedExport"],
						},
					],
				},
			},
			warnings: [],
		};

		const unusedExportsReport: UnusedExportsReport = {
			unusedExports: [
				{
					projectId: "lib-1",
					exportName: "unusedExport",
					sourceFile: "src/index.ts",
					isTypeOnly: false,
					exportType: "named",
					isReExport: false,
				},
			],
			warnings: [],
		};

		const report = generateMarkdownReport({
			inventory,
			graph,
			usage,
			exportsAnalysis,
			unusedExportsReport,
		});

		expect(report).toContain("## 📦 Export Analysis");
		expect(report).toContain("@repo/lib");
		expect(report).toContain("**Total exports:** 2");
		expect(report).toContain("**Used:** 1");
		expect(report).toContain("**Unused named exports:** 1");
		expect(report).toContain("usedExport");
		expect(report).toContain("unusedExport");
	});

	it("generates example entry point for partially used packages", () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": {
					id: "lib-1",
					root: "/fake/lib-1",
					relativeRoot: "packages/lib-1",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: "/fake/lib-1/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const exportsAnalysis: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "Button",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "Config",
							sourceFile: "src/index.ts",
							isTypeOnly: true,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "unused",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
					],
				},
			},
			warnings: [],
		};

		const usage: ProjectUsage = {
			usage: {
				"app-1": {
					dependencies: ["@repo/lib"],
					typeOnlyDependencies: [],
					usageDetails: [
						{
							dependencyId: "@repo/lib",
							specifier: "@repo/lib",
							isTypeOnly: false,
							sourceFile: "src/index.ts",
							namedImports: ["Button", "Config"],
						},
					],
				},
			},
			warnings: [],
		};

		const unusedExportsReport: UnusedExportsReport = {
			unusedExports: [
				{
					projectId: "lib-1",
					exportName: "unused",
					sourceFile: "src/index.ts",
					isTypeOnly: false,
					exportType: "named",
					isReExport: false,
				},
			],
			warnings: [],
		};

		const report = generateMarkdownReport({
			inventory,
			graph,
			usage,
			exportsAnalysis,
			unusedExportsReport,
		});

		expect(report).toContain("**Example Entry Point (src/index.ts):**");
		expect(report).toContain("export type {");
		expect(report).toContain("Config,");
		expect(report).toContain("export {");
		expect(report).toContain("Button,");
		expect(report).not.toContain("unused,");
	});

	it("handles scoped packages in export analysis", () => {
		const inventory: ProjectInventory = {
			projects: {
				ui: {
					id: "ui",
					root: "/fake/ui",
					relativeRoot: "packages/ui",
					packageJson: { name: "@scope/ui" },
					tsconfigPath: "/fake/ui/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const exportsAnalysis: ExportAnalysis = {
			projects: {
				ui: {
					projectId: "ui",
					exports: [
						{
							exportName: "Button",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
					],
				},
			},
			warnings: [],
		};

		const usage: ProjectUsage = {
			usage: {
				"app-1": {
					dependencies: ["@scope/ui"],
					typeOnlyDependencies: [],
					usageDetails: [
						{
							dependencyId: "@scope/ui",
							specifier: "@scope/ui",
							isTypeOnly: false,
							sourceFile: "src/index.ts",
							namedImports: ["Button"],
						},
					],
				},
			},
			warnings: [],
		};

		const unusedExportsReport: UnusedExportsReport = {
			unusedExports: [],
			warnings: [],
		};

		const report = generateMarkdownReport({
			inventory,
			graph,
			usage,
			exportsAnalysis,
			unusedExportsReport,
		});

		expect(report).toContain("@scope/ui");
		expect(report).toContain("**Used:** 1");
	});

	it("sorts projects by most unused exports", () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": {
					id: "lib-1",
					root: "/fake/lib-1",
					relativeRoot: "packages/lib-1",
					packageJson: { name: "@repo/lib-1" },
					tsconfigPath: "/fake/lib-1/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
				"lib-2": {
					id: "lib-2",
					root: "/fake/lib-2",
					relativeRoot: "packages/lib-2",
					packageJson: { name: "@repo/lib-2" },
					tsconfigPath: "/fake/lib-2/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const exportsAnalysis: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "foo",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
					],
				},
				"lib-2": {
					projectId: "lib-2",
					exports: [
						{
							exportName: "bar",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "baz",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
					],
				},
			},
			warnings: [],
		};

		const usage: ProjectUsage = {
			usage: {},
			warnings: [],
		};

		const unusedExportsReport: UnusedExportsReport = {
			unusedExports: [
				{
					projectId: "lib-1",
					exportName: "foo",
					sourceFile: "src/index.ts",
					isTypeOnly: false,
					exportType: "named",
					isReExport: false,
				},
				{
					projectId: "lib-2",
					exportName: "bar",
					sourceFile: "src/index.ts",
					isTypeOnly: false,
					exportType: "named",
					isReExport: false,
				},
				{
					projectId: "lib-2",
					exportName: "baz",
					sourceFile: "src/index.ts",
					isTypeOnly: false,
					exportType: "named",
					isReExport: false,
				},
			],
			warnings: [],
		};

		const report = generateMarkdownReport({
			inventory,
			graph,
			usage,
			exportsAnalysis,
			unusedExportsReport,
		});

		// lib-2 has 2 unused exports, should appear before lib-1 (1 unused)
		const lib1Index = report.indexOf("@repo/lib-1");
		const lib2Index = report.indexOf("@repo/lib-2");
		expect(lib2Index).toBeLessThan(lib1Index);
	});

	it("handles empty exports gracefully", () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": {
					id: "lib-1",
					root: "/fake/lib-1",
					relativeRoot: "packages/lib-1",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: "/fake/lib-1/tsconfig.json",
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const exportsAnalysis: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [],
				},
			},
			warnings: [],
		};

		const usage: ProjectUsage = {
			usage: {},
			warnings: [],
		};

		const unusedExportsReport: UnusedExportsReport = {
			unusedExports: [],
			warnings: [],
		};

		const report = generateMarkdownReport({
			inventory,
			graph,
			usage,
			exportsAnalysis,
			unusedExportsReport,
		});

		// Should not include projects with no exports
		expect(report).not.toContain("@repo/lib");
	});
});
