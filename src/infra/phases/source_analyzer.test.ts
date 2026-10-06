import { afterEach, describe, expect, test } from "vitest";
import { ConfigurationError } from "../../core/errors.js";
import type {
	ProjectScan,
	SourceAnalysis,
	SyncConfig,
	WorkspaceImport,
} from "../../core/types.js";
import { makeConfig } from "../../test_support/builders.js";
import { createCapturingLogger } from "../../test_support/logger.js";
import {
	createTempRepo,
	monorepo,
	type RepoFiles,
	sharedPackage,
	type TempRepo,
} from "../../test_support/temp_repo.js";
import { nodeFileSystem } from "../fs/node_fs.js";
import { createSourceAnalyzer } from "./source_analyzer.js";
import { createWorkspaceDiscovery } from "./workspace_discovery.js";

const repos: TempRepo[] = [];
afterEach(() => {
	for (const repo of repos.splice(0)) repo.cleanup();
});

async function analyze(
	files: RepoFiles,
	options: {
		config?: Partial<SyncConfig>;
		includeExports?: boolean;
		logger?: ReturnType<typeof createCapturingLogger>;
	} = {},
): Promise<SourceAnalysis> {
	const repo = createTempRepo(monorepo(files));
	repos.push(repo);
	const config = makeConfig(options.config);
	const logger = options.logger ?? createCapturingLogger();
	const inventory = await createWorkspaceDiscovery().discover(
		config,
		{ rootDir: repo.root },
		logger,
		nodeFileSystem,
	);
	return createSourceAnalyzer().analyze(
		inventory,
		config,
		{ includeExports: options.includeExports ?? false },
		logger,
	);
}

function scanned(scan: ProjectScan | undefined) {
	if (scan?.status !== "scanned") {
		throw new Error(`expected a scanned project, got ${JSON.stringify(scan)}`);
	}
	return scan;
}

function importsOf(analysis: SourceAnalysis, id: string): WorkspaceImport[] {
	return scanned(analysis.projects[id]).imports;
}

const LIB = sharedPackage(
	"packages/lib",
	"@x/lib",
	"export const a = 1;\nexport type T = string;\nexport default 1;\n",
);

function app(source: string, file = "src/index.ts", extra: RepoFiles = {}) {
	return {
		"apps/web/package.json": { name: "web" },
		"apps/web/tsconfig.json": {
			compilerOptions: { allowJs: true, noEmit: true },
		},
		[`apps/web/${file}`]: source,
		...extra,
	};
}

describe("source analyzer: import forms", () => {
	test("records every import form with its bindings and type-only flag", async () => {
		const analysis = await analyze({
			...LIB,
			...app(
				[
					'import def, { a, b as c } from "@x/lib";',
					'import type { T } from "@x/lib";',
					'import { type T as U, type V } from "@x/lib";',
					'import * as ns from "@x/lib";',
					'import "@x/lib";',
					'export { a as reA } from "@x/lib";',
					'export * from "@x/lib";',
					'export type { T as ReT } from "@x/lib";',
					'import eq = require("@x/lib");',
					'export const lazy = () => import("@x/lib");',
					'type Q = typeof import("@x/lib").Foo.Bar;',
					"export type { Q, U, V };",
					"export { def, c, ns, eq };",
				].join("\n"),
			),
		});

		const summary = importsOf(analysis, "web").map((i) => [
			i.isTypeOnly,
			i.bindings,
		]);
		expect(summary).toEqual([
			[false, { kind: "named", names: ["default", "a", "b"] }],
			[true, { kind: "named", names: ["T"] }],
			[true, { kind: "named", names: ["T", "V"] }],
			[false, { kind: "namespace" }],
			[false, { kind: "side-effect" }],
			[false, { kind: "named", names: ["a"] }],
			[false, { kind: "namespace" }],
			[true, { kind: "named", names: ["T"] }],
			[false, { kind: "namespace" }],
			[false, { kind: "namespace" }],
			[true, { kind: "named", names: ["Foo"] }],
		]);
		for (const imp of importsOf(analysis, "web")) {
			expect(imp.dependencyId).toBe("@x/lib");
			expect(imp.sourceFile).toBe("src/index.ts");
		}
	});

	test("finds require() in JavaScript and TypeScript files", async () => {
		const analysis = await analyze({
			...LIB,
			...sharedPackage("packages/other", "@x/other", "export const o = 1;"),
			...app(
				'const lib = require("@x/lib");\nmodule.exports = lib;\n',
				"src/main.js",
				{
					"apps/web/src/index.cts":
						'const other = require("@x/other");\nexport = other;\n',
				},
			),
		});
		const imports = importsOf(analysis, "web");
		expect(
			imports
				.map((i) => [i.dependencyId, i.sourceFile, i.bindings.kind])
				.sort(),
		).toEqual([
			["@x/lib", "src/main.js", "namespace"],
			["@x/other", "src/index.cts", "namespace"],
		]);
	});

	test("deep imports map to the package; external and relative imports are dropped", async () => {
		const analysis = await analyze({
			...LIB,
			...app(
				'import { x } from "@x/lib/deep/path";\nimport React from "react";\nimport { y } from "./local";\nexport { x, React, y };\n',
				"src/index.ts",
				{ "apps/web/src/local.ts": "export const y = 1;" },
			),
		});
		expect(importsOf(analysis, "web")).toEqual([
			{
				dependencyId: "@x/lib",
				specifier: "@x/lib/deep/path",
				sourceFile: "src/index.ts",
				isTypeOnly: false,
				bindings: { kind: "named", names: ["x"] },
			},
		]);
	});

	test("ignoreImports skips matching specifiers", async () => {
		const analysis = await analyze(
			{
				...LIB,
				...app(
					'import { a } from "@x/lib/internal";\nimport { b } from "@x/lib";\nexport { a, b };\n',
				),
			},
			{ config: { ignoreImports: ["@x/lib/*"] } },
		);
		expect(importsOf(analysis, "web").map((i) => i.specifier)).toEqual([
			"@x/lib",
		]);
	});

	test("excludePatterns skips files relative to the project root", async () => {
		const analysis = await analyze(
			{
				...LIB,
				...app('import { a } from "@x/lib";\nexport { a };\n', "src/index.ts", {
					"apps/web/src/index.test.ts":
						'import { T } from "@x/lib";\nexport type { T };\n',
				}),
			},
			{ config: { excludePatterns: ["**/*.test.ts"] } },
		);
		const scan = scanned(analysis.projects.web);
		expect(scan.fileCount).toBe(1);
		expect(scan.imports.map((i) => i.sourceFile)).toEqual(["src/index.ts"]);
	});
});

describe("source analyzer: which files belong to a project", () => {
	test("scans files outside src/ (e.g. a Next.js app/ directory)", async () => {
		const analysis = await analyze({
			...LIB,
			...app('import { a } from "@x/lib";\nexport default a;\n', "app/page.ts"),
		});
		expect(importsOf(analysis, "web").map((i) => i.sourceFile)).toEqual([
			"app/page.ts",
		]);
	});

	test("follows local references of a solution-style tsconfig", async () => {
		const analysis = await analyze({
			...LIB,
			"apps/web/package.json": { name: "web" },
			"apps/web/tsconfig.json": {
				files: [],
				references: [
					{ path: "./tsconfig.app.json" },
					{ path: "./tsconfig.node.json" },
				],
			},
			"apps/web/tsconfig.app.json": { include: ["src"] },
			"apps/web/tsconfig.node.json": { include: ["vite.config.ts"] },
			"apps/web/src/main.ts": 'import { a } from "@x/lib";\nexport { a };\n',
			"apps/web/vite.config.ts":
				'import type { T } from "@x/lib";\nexport type { T };\n',
		});
		const scan = scanned(analysis.projects.web);
		expect(scan.fileCount).toBe(2);
		expect(scan.imports.map((i) => i.sourceFile).sort()).toEqual([
			"src/main.ts",
			"vite.config.ts",
		]);
	});

	test("scans standalone tsconfig.json files in subdirectories", async () => {
		// e.g. Convex: convex/tsconfig.json is its own project, not referenced from the root.
		const analysis = await analyze({
			...LIB,
			"apps/web/package.json": { name: "web" },
			"apps/web/tsconfig.json": { include: ["src"] },
			"apps/web/src/index.ts": "export {};\n",
			"apps/web/convex/tsconfig.json": { compilerOptions: { noEmit: true } },
			"apps/web/convex/lib.ts":
				'import { a } from "@x/lib";\nexport default a;\n',
		});
		expect(importsOf(analysis, "web").map((i) => i.sourceFile)).toEqual([
			"convex/lib.ts",
		]);
	});

	test("a project with only nested tsconfig files is scanned", async () => {
		const analysis = await analyze(
			{
				...LIB,
				"apps/db/package.json": { name: "db" },
				"apps/db/convex/tsconfig.json": {},
				"apps/db/convex/schema.ts":
					'import { a } from "@x/lib";\nexport default a;\n',
			},
			{
				config: {
					workspaceTypes: {
						"apps/*": { type: "app", requiresTsconfig: false },
						"packages/*": { type: "shared-package", requiresTsconfig: true },
					},
				},
			},
		);
		expect(importsOf(analysis, "db").map((i) => i.sourceFile)).toEqual([
			"convex/schema.ts",
		]);
	});

	test("excludePatterns also skip nested tsconfig files", async () => {
		const analysis = await analyze(
			{
				...LIB,
				...app("export {};\n"),
				"apps/web/fixtures/broken/tsconfig.json": "{ not json",
				"apps/web/fixtures/broken/index.ts": 'import "@x/lib";\n',
			},
			{ config: { excludePatterns: ["fixtures/**"] } },
		);
		expect(importsOf(analysis, "web")).toEqual([]);
	});

	test("files of a nested workspace project belong to the nested project", async () => {
		const repo = createTempRepo({
			"package.json": {
				name: "root",
				private: true,
				workspaces: ["packages/*", "packages/outer/plugins/*"],
			},
			...LIB,
			"packages/outer/package.json": {
				name: "@x/outer",
				exports: "./src/index.ts",
			},
			"packages/outer/tsconfig.json": {},
			"packages/outer/src/index.ts": "export const outer = 1;",
			"packages/outer/plugins/inner/package.json": { name: "@x/inner" },
			"packages/outer/plugins/inner/tsconfig.json": {},
			"packages/outer/plugins/inner/index.ts":
				'import { a } from "@x/lib";\nexport { a };\n',
		});
		repos.push(repo);
		const config = makeConfig({
			workspaceTypes: {
				"packages/*": { type: "shared-package", requiresTsconfig: true },
				"packages/outer/plugins/*": { type: "app", requiresTsconfig: true },
			},
		});
		const logger = createCapturingLogger();
		const inventory = await createWorkspaceDiscovery().discover(
			config,
			{ rootDir: repo.root },
			logger,
			nodeFileSystem,
		);
		const analysis = await createSourceAnalyzer().analyze(
			inventory,
			config,
			{ includeExports: false },
			logger,
		);
		const outer = scanned(analysis.projects["@x/outer"]);
		expect(outer.fileCount).toBe(1);
		expect(outer.imports).toEqual([]);
		expect(importsOf(analysis, "@x/inner").map((i) => i.sourceFile)).toEqual([
			"index.ts",
		]);
	});

	test("a project without tsconfig.json is skipped", async () => {
		const analysis = await analyze(
			{
				...LIB,
				"apps/web/package.json": { name: "web" },
				"apps/web/index.js": 'require("@x/lib");',
			},
			{
				config: {
					workspaceTypes: {
						"apps/*": { type: "app", requiresTsconfig: false },
						"packages/*": { type: "shared-package", requiresTsconfig: true },
					},
				},
			},
		);
		expect(analysis.projects.web).toEqual({
			status: "skipped",
			reason: "it has no tsconfig.json files",
		});
	});

	test("skipping a project configured without a tsconfig is not a warning", async () => {
		const logger = createCapturingLogger();
		await analyze(
			{ ...LIB, "apps/site/package.json": { name: "site" } },
			{
				logger,
				config: {
					workspaceTypes: {
						"apps/*": { type: "app", requiresTsconfig: false },
						"packages/*": { type: "shared-package", requiresTsconfig: true },
					},
				},
			},
		);
		expect(logger.messages.warn).toEqual([]);
		expect(logger.messages.debug).toContain(
			"site was not scanned and will not be modified: it has no tsconfig.json files",
		);
	});

	test("a tsconfig that includes none of the project's files is a warning", async () => {
		const logger = createCapturingLogger();
		await analyze(
			{
				...LIB,
				"apps/web/package.json": { name: "web" },
				"apps/web/tsconfig.json": {
					files: [],
					references: [{ path: "../../packages/lib" }],
				},
			},
			{ logger },
		);
		expect(logger.messages.warn).toEqual([
			"web was not scanned and will not be modified: its tsconfig files include no source files of its own",
		]);
	});

	test("a tsconfig that includes no files of its own is skipped", async () => {
		// Only a reference to another workspace project: nothing local to scan.
		const analysis = await analyze({
			...LIB,
			"apps/web/package.json": { name: "web" },
			"apps/web/tsconfig.json": {
				files: [],
				references: [{ path: "../../packages/lib" }],
			},
		});
		expect(analysis.projects.web?.status).toBe("skipped");
	});

	test("an invalid tsconfig is a configuration error", async () => {
		await expect(
			analyze({
				...LIB,
				"apps/web/package.json": { name: "web" },
				"apps/web/tsconfig.json": '{ "compilerOptions": { "strict": tru } }',
				"apps/web/src/index.ts": "export {};",
			}),
		).rejects.toBeInstanceOf(ConfigurationError);
	});

	test("a local reference to a missing tsconfig is a configuration error", async () => {
		await expect(
			analyze({
				...LIB,
				"apps/web/package.json": { name: "web" },
				"apps/web/tsconfig.json": {
					files: [],
					references: [{ path: "./tsconfig.app.json" }],
				},
			}),
		).rejects.toThrow(/tsconfig\.app\.json, which does not exist/);
	});
});

describe("source analyzer: entry points", () => {
	async function entryOf(pkg: RepoFiles) {
		const analysis = await analyze({
			...pkg,
			"packages/lib/src/index.ts": "export const a = 1;",
			"packages/lib/src/view.tsx": "export const v = 1;",
		});
		return analysis.entryPoints["@x/lib"];
	}

	const pkgFiles = (packageJson: object, tsconfig: object = {}): RepoFiles => ({
		"packages/lib/package.json": { name: "@x/lib", ...packageJson },
		"packages/lib/tsconfig.json": tsconfig,
	});

	test('"exports" string pointing at source', async () => {
		expect(await entryOf(pkgFiles({ exports: "./src/index.ts" }))).toEqual({
			status: "resolved",
			path: "src/index.ts",
		});
	});

	test('"exports" conditions under "." are checked in order (types first)', async () => {
		expect(
			await entryOf(
				pkgFiles({
					exports: {
						".": { import: "./src/view.tsx", types: "./src/index.ts" },
					},
				}),
			),
		).toEqual({ status: "resolved", path: "src/index.ts" });
	});

	test('"exports" without a "." entry is unresolved (no fallback to main)', async () => {
		const entry = await entryOf(
			pkgFiles({
				exports: { "./view": "./src/view.tsx" },
				main: "./src/index.ts",
			}),
		);
		expect(entry).toEqual({
			status: "unresolved",
			reason: '"exports" does not define a "." entry point',
		});
	});

	test('"types" and then "main" are used when there is no "exports"', async () => {
		expect(
			await entryOf(pkgFiles({ types: "src/index.ts", main: "src/view.tsx" })),
		).toEqual({ status: "resolved", path: "src/index.ts" });
		expect(await entryOf(pkgFiles({ main: "src/view.tsx" }))).toEqual({
			status: "resolved",
			path: "src/view.tsx",
		});
	});

	test("build output in outDir maps back to source in rootDir", async () => {
		const tsconfig = { compilerOptions: { outDir: "dist", rootDir: "src" } };
		expect(
			await entryOf(pkgFiles({ types: "./dist/index.d.ts" }, tsconfig)),
		).toEqual({ status: "resolved", path: "src/index.ts" });
		expect(
			await entryOf(pkgFiles({ main: "./dist/view.js" }, tsconfig)),
		).toEqual({ status: "resolved", path: "src/view.tsx" });
	});

	test("build output with no matching source is unresolved", async () => {
		const entry = await entryOf(
			pkgFiles(
				{ main: "./dist/missing.js" },
				{ compilerOptions: { outDir: "dist", rootDir: "src" } },
			),
		);
		expect(entry?.status).toBe("unresolved");
	});

	test("a declared source file that does not exist is unresolved", async () => {
		expect(await entryOf(pkgFiles({ exports: "./src/nope.ts" }))).toEqual({
			status: "unresolved",
			reason: '"exports" points to ./src/nope.ts, which does not exist',
		});
	});

	test("build output outside any outDir is unresolved", async () => {
		const entry = await entryOf(pkgFiles({ main: "./dist/index.js" }));
		expect(entry?.status).toBe("unresolved");
	});

	test("a hand-written declaration file outside any outDir is used as-is", async () => {
		expect(
			await entryOf({
				"packages/lib/package.json": {
					name: "@x/lib",
					exports: {
						".": { types: "./plugin.d.ts", default: "./plugin.js" },
					},
				},
				"packages/lib/tsconfig.json": { include: ["*.ts"] },
				"packages/lib/plugin.d.ts": "export declare const plugin: number;\n",
				"packages/lib/plugin.js": "export const plugin = 1;\n",
			}),
		).toEqual({ status: "resolved", path: "plugin.d.ts" });
	});

	test("a package that declares no entry point is unresolved", async () => {
		expect(await entryOf(pkgFiles({}))).toEqual({
			status: "unresolved",
			reason:
				'package.json declares no entry point ("exports", "types" or "main")',
		});
	});
});

describe("source analyzer: exports", () => {
	test("lists entry point exports with type, kind and re-export flags", async () => {
		const analysis = await analyze(
			{
				...sharedPackage(
					"packages/lib",
					"@x/lib",
					[
						'export * from "./star";',
						'export { named as renamed } from "./named";',
						'export type { Shape } from "./named";',
						"export interface I {}",
						"export type Alias = string;",
						"export class C {}",
						"export enum E { A }",
						"export namespace N { export const q = 1; }",
						"export function f() {}",
						"export const v = 1;",
						"export default 42;",
					].join("\n"),
				),
				"packages/lib/src/star.ts":
					"export const fromStar = 1;\nexport type StarT = number;\n",
				"packages/lib/src/named.ts":
					"export const named = 1;\nexport interface Shape {}\n",
				...app('import { v } from "@x/lib";\nexport { v };\n'),
			},
			{ includeExports: true },
		);

		expect(Object.keys(analysis.exports ?? {})).toEqual(["@x/lib"]);
		const byName = Object.fromEntries(
			(analysis.exports?.["@x/lib"] ?? []).map((e) => [e.exportName, e]),
		);
		expect(Object.keys(byName).sort()).toEqual(
			[
				"Alias",
				"C",
				"E",
				"I",
				"N",
				"Shape",
				"StarT",
				"default",
				"f",
				"fromStar",
				"renamed",
				"v",
			].sort(),
		);
		const flags = (name: string) => {
			const e = byName[name];
			return [e?.isTypeOnly, e?.exportType, e?.isReExport];
		};
		expect(flags("I")).toEqual([true, "named", false]);
		expect(flags("Alias")).toEqual([true, "named", false]);
		expect(flags("Shape")).toEqual([true, "named", false]);
		expect(flags("C")).toEqual([false, "named", false]);
		expect(flags("E")).toEqual([false, "named", false]);
		expect(flags("N")).toEqual([false, "namespace", false]);
		expect(flags("f")).toEqual([false, "named", false]);
		expect(flags("v")).toEqual([false, "named", false]);
		expect(flags("default")).toEqual([false, "default", false]);
		expect(flags("renamed")).toEqual([false, "named", false]);
		expect(flags("fromStar")).toEqual([false, "named", true]);
		expect(flags("StarT")).toEqual([true, "named", true]);
	});

	test("exports are only collected when requested", async () => {
		const analysis = await analyze({ ...LIB });
		expect(analysis.exports).toBeUndefined();
	});
});
