import { describe, expect, test } from "vitest";
import {
	makeConfig,
	makeInventory,
	makeProject,
	makeResolvedProject,
	ROOT,
} from "../test_support/builders.js";
import { planPackageJson, planTsconfig } from "./sync_plan.js";
import type { ProjectInfo, ResolvedProject } from "./types.js";

const app = makeProject("app", {
	relativeRoot: "apps/app",
	workspaceType: "app",
});
const ui = makeProject("@x/ui");
const utils = makeProject("@x/utils");
const old = makeProject("@x/old");
const inventory = makeInventory([app, ui, utils, old]);
const config = makeConfig();
const APP_TSCONFIG = `${ROOT}/apps/app/tsconfig.json`;

function resolved(
	deps: ProjectInfo[],
	project: ProjectInfo = app,
): ResolvedProject {
	return makeResolvedProject(project, deps);
}

describe("planPackageJson", () => {
	test("adds imported workspace dependencies with the configured version", () => {
		const plan = planPackageJson(
			resolved([utils, ui]),
			{ name: "app" },
			inventory,
			config,
		);
		expect(plan.edits).toEqual([
			{
				path: ["dependencies", "@x/ui"],
				value: "workspace:*",
				sortedInsert: true,
			},
			{
				path: ["dependencies", "@x/utils"],
				value: "workspace:*",
				sortedInsert: true,
			},
		]);
		expect(plan.changes.map((c) => c.action)).toEqual(["add", "add"]);
	});

	test("removes workspace dependencies that aren't imported, keeps external ones", () => {
		const plan = planPackageJson(
			resolved([ui]),
			{
				name: "app",
				dependencies: {
					"@x/old": "workspace:*",
					"@x/ui": "workspace:*",
					react: "^19.0.0",
				},
			},
			inventory,
			config,
		);
		expect(plan.edits).toEqual([
			{ path: ["dependencies", "@x/old"], value: undefined },
		]);
		expect(plan.changes).toEqual([
			{
				action: "remove",
				description: 'dependencies["@x/old"] (not imported)',
			},
		]);
	});

	test("removes stale workspace dependencies declared without the workspace protocol", () => {
		const plan = planPackageJson(
			resolved([]),
			{ dependencies: { "@x/old": "*" } },
			inventory,
			config,
		);
		expect(plan.edits).toEqual([
			{ path: ["dependencies", "@x/old"], value: undefined },
		]);
	});

	test("updates a dependency declared with a different version", () => {
		const plan = planPackageJson(
			resolved([ui]),
			{ dependencies: { "@x/ui": "workspace:^" } },
			inventory,
			config,
		);
		expect(plan.edits).toEqual([
			{
				path: ["dependencies", "@x/ui"],
				value: "workspace:*",
				sortedInsert: true,
			},
		]);
		expect(plan.changes[0]?.action).toBe("update");
	});

	test("honors workspaceDependencyVersion", () => {
		const plan = planPackageJson(
			resolved([ui]),
			{ dependencies: { "@x/ui": "workspace:*" } },
			inventory,
			makeConfig({ workspaceDependencyVersion: "*" }),
		);
		expect(plan.edits).toEqual([
			{ path: ["dependencies", "@x/ui"], value: "*", sortedInsert: true },
		]);
	});

	test("devDependencies count as declared and are never removed", () => {
		const plan = planPackageJson(
			resolved([ui]),
			{
				devDependencies: {
					"@x/ui": "workspace:*",
					"@x/old": "workspace:*",
				},
			},
			inventory,
			config,
		);
		expect(plan.edits).toEqual([]);
		expect(plan.changes).toEqual([]);
	});

	test("devDependencies with another version are updated in place", () => {
		const plan = planPackageJson(
			resolved([ui]),
			{ devDependencies: { "@x/ui": "workspace:^" } },
			inventory,
			config,
		);
		expect(plan.edits).toEqual([
			{
				path: ["devDependencies", "@x/ui"],
				value: "workspace:*",
				sortedInsert: true,
			},
		]);
	});

	test("peerDependencies are left alone", () => {
		const plan = planPackageJson(
			resolved([ui]),
			{ peerDependencies: { "@x/ui": "^1.0.0", "@x/old": "^1.0.0" } },
			inventory,
			config,
		);
		expect(plan.edits).toEqual([]);
	});

	test("no edits when already in sync", () => {
		const plan = planPackageJson(
			resolved([ui]),
			{ name: "app", dependencies: { "@x/ui": "workspace:*", zod: "^3" } },
			inventory,
			config,
		);
		expect(plan).toEqual({ edits: [], changes: [] });
	});

	test("applies the package.json template with {{projectDir}}", () => {
		const project = makeProject("app", {
			relativeRoot: "apps/app",
			workspaceType: "app",
			workspaceConfig: {
				packageJsonTemplate: {
					private: true,
					scripts: { build: "tsc -b {{projectDir}}" },
				},
			},
		});
		const plan = planPackageJson(
			resolved([], project),
			{ name: "app", private: true, scripts: { test: "vitest" } },
			inventory,
			config,
		);
		expect(plan.edits).toEqual([
			{ path: ["scripts", "build"], value: "tsc -b app" },
		]);
		expect(plan.changes[0]?.action).toBe("add");
		expect(plan.changes[0]?.description).toContain("(template)");
	});

	test("template arrays and scalars replace existing values", () => {
		const project = makeProject("app", {
			relativeRoot: "apps/app",
			workspaceConfig: {
				packageJsonTemplate: { files: ["dist"], private: true },
			},
		});
		const plan = planPackageJson(
			resolved([], project),
			{ files: ["src", "dist"], private: false },
			inventory,
			config,
		);
		expect(plan.edits).toEqual([
			{ path: ["files"], value: ["dist"] },
			{ path: ["private"], value: true },
		]);
		expect(plan.changes.map((c) => c.action)).toEqual(["update", "update"]);
	});
});

describe("planTsconfig", () => {
	test("adds paths and references for workspace dependencies", () => {
		const plan = planTsconfig(resolved([ui]), {}, APP_TSCONFIG, inventory);
		expect(plan.edits).toEqual([
			{
				path: ["compilerOptions", "paths", "@x/ui"],
				value: ["../../packages/ui/src/index.ts"],
				sortedInsert: true,
			},
			{
				path: ["compilerOptions", "paths", "@x/ui/*"],
				value: ["../../packages/ui/src/*"],
				sortedInsert: true,
			},
			{ path: ["references"], value: [{ path: "../../packages/ui" }] },
		]);
		expect(plan.changes.map((c) => c.action)).toEqual(["add", "add", "add"]);
	});

	test("wildcard path follows the entry point's directory", () => {
		const project = resolved([ui]);
		const dep = project.dependencies["@x/ui"];
		if (dep) dep.entryPoint = "index.ts";
		const plan = planTsconfig(project, {}, APP_TSCONFIG, inventory);
		expect(plan.edits.slice(0, 2).map((e) => e.value)).toEqual([
			["../../packages/ui/index.ts"],
			["../../packages/ui/*"],
		]);
	});

	test("removes workspace paths that aren't imported and keeps others", () => {
		const plan = planTsconfig(
			resolved([ui]),
			{
				compilerOptions: {
					paths: {
						"@x/ui": ["../../packages/ui/src/index.ts"],
						"@x/ui/*": ["../../packages/ui/src/*"],
						"@x/old": ["../../packages/old/src/index.ts"],
						"@x/old/*": ["../../packages/old/src/*"],
						"~/*": ["./src/*"],
					},
				},
				references: [{ path: "../../packages/ui" }],
			},
			APP_TSCONFIG,
			inventory,
		);
		expect(plan.edits).toEqual([
			{ path: ["compilerOptions", "paths", "@x/old"], value: undefined },
			{ path: ["compilerOptions", "paths", "@x/old/*"], value: undefined },
		]);
	});

	test("keeps non-workspace references first and sorts workspace references", () => {
		const plan = planTsconfig(
			resolved([utils, ui]),
			{
				compilerOptions: {
					paths: {
						"@x/ui": ["../../packages/ui/src/index.ts"],
						"@x/ui/*": ["../../packages/ui/src/*"],
						"@x/utils": ["../../packages/utils/src/index.ts"],
						"@x/utils/*": ["../../packages/utils/src/*"],
					},
				},
				references: [
					{ path: "../../packages/utils" },
					{ path: "./tsconfig.app.json" },
					{ path: "../../packages/old" },
					{ path: "./tsconfig.node.json" },
				],
			},
			APP_TSCONFIG,
			inventory,
		);
		expect(plan.edits).toEqual([
			{
				path: ["references"],
				value: [
					{ path: "./tsconfig.app.json" },
					{ path: "./tsconfig.node.json" },
					{ path: "../../packages/ui" },
					{ path: "../../packages/utils" },
				],
			},
		]);
		expect(plan.changes).toEqual([
			{
				action: "remove",
				description: 'reference "../../packages/old" (not imported)',
			},
			{ action: "add", description: 'reference "../../packages/ui"' },
		]);
	});

	test("recognizes a reference that points at the dependency's tsconfig.json", () => {
		const plan = planTsconfig(
			resolved([ui]),
			{
				compilerOptions: {
					paths: {
						"@x/ui": ["../../packages/ui/src/index.ts"],
						"@x/ui/*": ["../../packages/ui/src/*"],
					},
				},
				references: [{ path: "../../packages/ui/tsconfig.json" }],
			},
			APP_TSCONFIG,
			inventory,
		);
		expect(plan).toEqual({ edits: [], changes: [] });
	});

	test("dependencies without a tsconfig get paths but no reference", () => {
		const jsOnly = makeProject("@x/js", { tsconfigPath: undefined });
		const plan = planTsconfig(
			resolved([jsOnly]),
			{},
			APP_TSCONFIG,
			makeInventory([app, jsOnly]),
		);
		expect(plan.edits.map((e) => e.path)).toEqual([
			["compilerOptions", "paths", "@x/js"],
			["compilerOptions", "paths", "@x/js/*"],
		]);
	});

	test("doesn't add an empty references array when there's nothing to reference", () => {
		const plan = planTsconfig(
			resolved([]),
			{ compilerOptions: { strict: true } },
			APP_TSCONFIG,
			inventory,
		);
		expect(plan).toEqual({ edits: [], changes: [] });
	});

	test("removes the last workspace reference, leaving an empty array", () => {
		const plan = planTsconfig(
			resolved([]),
			{ references: [{ path: "../../packages/old" }] },
			APP_TSCONFIG,
			inventory,
		);
		expect(plan.edits).toEqual([{ path: ["references"], value: [] }]);
	});

	test("applies the tsconfig template, merging objects", () => {
		const project = makeProject("app", {
			relativeRoot: "apps/app",
			workspaceConfig: {
				tsconfigTemplate: {
					extends: "../../tsconfig.base.json",
					compilerOptions: { outDir: "../../dist/{{projectDir}}" },
				},
			},
		});
		const plan = planTsconfig(
			resolved([], project),
			{ compilerOptions: { strict: true } },
			APP_TSCONFIG,
			inventory,
		);
		expect(plan.edits).toEqual([
			{ path: ["extends"], value: "../../tsconfig.base.json" },
			{ path: ["compilerOptions", "outDir"], value: "../../dist/app" },
		]);
	});

	test("no edits when in sync", () => {
		const plan = planTsconfig(
			resolved([ui]),
			{
				compilerOptions: {
					paths: {
						"@x/ui": ["../../packages/ui/src/index.ts"],
						"@x/ui/*": ["../../packages/ui/src/*"],
					},
				},
				references: [{ path: "../../packages/ui" }],
			},
			APP_TSCONFIG,
			inventory,
		);
		expect(plan).toEqual({ edits: [], changes: [] });
	});
});
