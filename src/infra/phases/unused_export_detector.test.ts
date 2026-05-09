import { describe, expect, it } from "vitest";
import { createMockLogger } from "../../core/test-helpers.js";
import type {
	ExportAnalysis,
	ProjectInfo,
	ProjectInventory,
	ProjectUsage,
	RepoManagerOptions,
	SyncConfig,
	UsageRecord,
} from "../../core/types.js";
import { createUnusedExportDetector } from "./unused_export_detector.js";

function createMockProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
	return {
		id: "lib-1",
		root: "/fake/lib-1",
		relativeRoot: "packages/lib-1",
		packageJson: { name: "@repo/lib" },
		tsconfigPath: "/fake/lib-1/tsconfig.json",
		workspaceType: "shared-package",
		workspaceSubType: "library",
		isPrivate: false,
		...overrides,
	};
}

function createUsageRecord(
	specifier: string,
	namedImports?: string[],
): UsageRecord {
	return {
		dependencyId: specifier,
		specifier,
		isTypeOnly: false,
		sourceFile: "src/index.ts",
		namedImports,
	};
}

describe("Unused Export Detector", () => {
	it("detects unused exports", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": createMockProject(),
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const exports: ExportAnalysis = {
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
					usageDetails: [createUsageRecord("@repo/lib", ["usedExport"])],
				},
			},
			warnings: [],
		};

		const detector = createUnusedExportDetector();
		const result = await detector.detect(
			exports,
			usage,
			inventory,
			{} as SyncConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
		);

		expect(result.unusedExports).toHaveLength(1);
		expect(result.unusedExports[0]?.exportName).toBe("unusedExport");
	});

	it("marks all exports as used when package is imported generically", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": createMockProject(),
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const exports: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "export1",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "export2",
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
					usageDetails: [createUsageRecord("@repo/lib")],
				},
			},
			warnings: [],
		};

		const detector = createUnusedExportDetector();
		const result = await detector.detect(
			exports,
			usage,
			inventory,
			{} as SyncConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
		);

		expect(result.unusedExports).toHaveLength(0);
	});

	it("handles namespace imports", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": createMockProject(),
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const exports: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "export1",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "export2",
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
					usageDetails: [createUsageRecord("@repo/lib", ["*"])],
				},
			},
			warnings: [],
		};

		const detector = createUnusedExportDetector();
		const result = await detector.detect(
			exports,
			usage,
			inventory,
			{} as SyncConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
		);

		// All exports should be marked as used due to namespace import
		expect(result.unusedExports).toHaveLength(0);
	});

	it("handles internal package usage", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": createMockProject(),
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const exports: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "publicApi",
							sourceFile: "src/index.ts",
							isTypeOnly: false,
							exportType: "named",
							isReExport: false,
						},
						{
							exportName: "internalHelper",
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
				"lib-1": {
					dependencies: ["@repo/lib"],
					typeOnlyDependencies: [],
					usageDetails: [createUsageRecord("@repo/lib", ["internalHelper"])],
				},
			},
			warnings: [],
		};

		const detector = createUnusedExportDetector();
		const result = await detector.detect(
			exports,
			usage,
			inventory,
			{} as SyncConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
		);

		// internalHelper is used internally, publicApi is not used
		expect(result.unusedExports).toHaveLength(1);
		expect(result.unusedExports[0]?.exportName).toBe("publicApi");
	});

	it("handles scoped package names with subpaths", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": createMockProject(),
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const exports: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "helper",
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
					usageDetails: [createUsageRecord("@repo/lib/utils", ["helper"])],
				},
			},
			warnings: [],
		};

		const detector = createUnusedExportDetector();
		const result = await detector.detect(
			exports,
			usage,
			inventory,
			{} as SyncConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
		);

		// Should correctly extract @repo/lib from @repo/lib/utils
		expect(result.unusedExports).toHaveLength(0);
	});

	it("handles non-workspace dependencies", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": createMockProject(),
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const exports: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "myExport",
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
					dependencies: ["react", "lodash"],
					typeOnlyDependencies: [],
					usageDetails: [
						createUsageRecord("react", ["useState"]),
						createUsageRecord("lodash", ["map"]),
					],
				},
			},
			warnings: [],
		};

		const detector = createUnusedExportDetector();
		const result = await detector.detect(
			exports,
			usage,
			inventory,
			{} as SyncConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
		);

		// All exports should be unused since no workspace packages are imported
		expect(result.unusedExports).toHaveLength(1);
		expect(result.unusedExports[0]?.exportName).toBe("myExport");
	});

	it("returns no unused exports when all are used", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": createMockProject(),
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const exports: ExportAnalysis = {
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
						{
							exportName: "bar",
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
					usageDetails: [createUsageRecord("@repo/lib", ["foo", "bar"])],
				},
			},
			warnings: [],
		};

		const detector = createUnusedExportDetector();
		const result = await detector.detect(
			exports,
			usage,
			inventory,
			{} as SyncConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
		);

		expect(result.unusedExports).toHaveLength(0);
	});

	it("handles empty usage", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"lib-1": createMockProject(),
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const exports: ExportAnalysis = {
			projects: {
				"lib-1": {
					projectId: "lib-1",
					exports: [
						{
							exportName: "lonely",
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

		const detector = createUnusedExportDetector();
		const result = await detector.detect(
			exports,
			usage,
			inventory,
			{} as SyncConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
		);

		// No usage means everything is unused
		expect(result.unusedExports).toHaveLength(1);
		expect(result.unusedExports[0]?.exportName).toBe("lonely");
	});
});
