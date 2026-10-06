import { existsSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { runCli } from "../../src/interface/cli/run.js";
import {
	createTempRepo,
	monorepo,
	type RepoFiles,
	sharedPackage,
	type TempRepo,
} from "../../src/test_support/temp_repo.js";

const repos: TempRepo[] = [];
afterEach(() => {
	for (const repo of repos.splice(0)) repo.cleanup();
});

function repoWith(files: RepoFiles, config: object = {}): TempRepo {
	const repo = createTempRepo(monorepo(files, config));
	repos.push(repo);
	return repo;
}

/** Runs the CLI inside `repo`, capturing everything it prints. */
async function run(repo: TempRepo | undefined, args: string[]) {
	const originalCwd = process.cwd();
	const originals = {
		log: console.log,
		warn: console.warn,
		error: console.error,
	};
	const lines: string[] = [];
	const capture = (...parts: unknown[]) => {
		lines.push(parts.map(String).join(" "));
	};
	console.log = capture;
	console.warn = capture;
	console.error = capture;
	try {
		if (repo) process.chdir(repo.root);
		const code = await runCli(args);
		return { code, output: lines.join("\n") };
	} finally {
		process.chdir(originalCwd);
		Object.assign(console, originals);
	}
}

/** Snapshot of the given files' contents, to assert nothing was written. */
function contents(repo: TempRepo, paths: string[]): string[] {
	return paths.map((p) => repo.read(p));
}

const UI = sharedPackage(
	"packages/ui",
	"@x/ui",
	"export const Button = 1;\nexport const Unused = 2;\n",
);

function app(
	dir: string,
	name: string,
	source: string,
	packageJson: object = {},
	file = "src/index.ts",
): RepoFiles {
	return {
		[`apps/${dir}/package.json`]: { name, ...packageJson },
		[`apps/${dir}/tsconfig.json`]: {},
		[`apps/${dir}/${file}`]: source,
	};
}

describe("sync keeps dependencies the old scanner missed", () => {
	test("Next app/ dir, dynamic import, Vite solution tsconfig and JSONC tsconfig", async () => {
		const declared = { dependencies: { "@x/ui": "workspace:*" } };
		const repo = repoWith({
			...UI,
			...app(
				"next",
				"next-app",
				'import { Button } from "@x/ui";\nexport default Button;\n',
				declared,
				"app/page.ts",
			),
			...app(
				"lazy",
				"lazy-app",
				'export const load = () => import("@x/ui");\n',
				declared,
			),
			"apps/vite/package.json": { name: "vite-app", ...declared },
			"apps/vite/tsconfig.json": {
				files: [],
				references: [
					{ path: "./tsconfig.app.json" },
					{ path: "./tsconfig.node.json" },
				],
			},
			"apps/vite/tsconfig.app.json": { include: ["src"] },
			"apps/vite/tsconfig.node.json": { include: ["vite.config.ts"] },
			"apps/vite/vite.config.ts": "export default {};\n",
			"apps/vite/src/main.ts":
				'import { Button } from "@x/ui";\nconsole.log(Button);\n',
			"apps/commented/package.json": { name: "commented-app" },
			"apps/commented/tsconfig.json":
				'{\n  // keep this comment\n  "compilerOptions": {\n    "strict": true,\n  },\n}\n',
			"apps/commented/src/index.ts":
				'import { Button } from "@x/ui";\nconsole.log(Button);\n',
		});

		const { code } = await run(repo, []);
		expect(code).toBe(0);

		for (const dir of ["next", "lazy", "vite", "commented"]) {
			expect(
				repo.readJson<{ dependencies?: Record<string, string> }>(
					`apps/${dir}/package.json`,
				).dependencies,
			).toEqual({ "@x/ui": "workspace:*" });
		}

		const viteRefs = repo.readJson<{ references: Array<{ path: string }> }>(
			"apps/vite/tsconfig.json",
		).references;
		expect(viteRefs.map((r) => r.path)).toEqual([
			"./tsconfig.app.json",
			"./tsconfig.node.json",
			"../../packages/ui",
		]);

		const commented = repo.read("apps/commented/tsconfig.json");
		expect(commented).toContain("// keep this comment");
		expect(commented).toContain('"@x/ui": [');
		expect(commented).toContain('"path": "../../packages/ui"');
	});
});

describe("--check and --dry-run", () => {
	const files = (): RepoFiles => ({
		...UI,
		...app(
			"web",
			"web",
			'import { Button } from "@x/ui";\nconsole.log(Button);\n',
		),
	});
	const watched = ["apps/web/package.json", "apps/web/tsconfig.json"];

	test("--check fails when a dependency is missing, without writing", async () => {
		const repo = repoWith(files());
		const before = contents(repo, watched);

		const { code, output } = await run(repo, ["--check"]);

		expect(code).toBe(1);
		expect(output).toContain('dependencies["@x/ui"] = "workspace:*"');
		expect(output).toContain("out of sync");
		expect(contents(repo, watched)).toEqual(before);
	});

	test("--dry-run reports changes but writes nothing", async () => {
		const repo = repoWith(files());
		const before = contents(repo, watched);

		const { code, output } = await run(repo, ["--dry-run"]);

		expect(code).toBe(0);
		expect(output).toMatch(/Files to modify: [1-9]\d*$/m);
		expect(contents(repo, watched)).toEqual(before);
	});

	test("sync is idempotent: --check passes after a sync", async () => {
		const repo = repoWith({
			...files(),
			"packages/ui/tsconfig.json": {
				compilerOptions: { composite: true },
				include: ["src"],
			},
		});

		expect((await run(repo, [])).code).toBe(0);
		const afterSync = contents(repo, watched);
		const { code, output } = await run(repo, ["--check"]);

		expect(code).toBe(0);
		expect(output).toMatch(/Files to modify: 0$/m);
		expect(contents(repo, watched)).toEqual(afterSync);
	});
});

describe("nested tsconfig files", () => {
	test("imports under a standalone convex/tsconfig.json keep their dependency; the nested config is never written", async () => {
		const convexConfig =
			'{\n\t// Convex owns this file\n\t"compilerOptions": { "noEmit": true }\n}\n';
		const repo = repoWith({
			...UI,
			"apps/db/package.json": {
				name: "db",
				dependencies: { "@x/ui": "workspace:*" },
			},
			"apps/db/tsconfig.json": { include: ["src"] },
			"apps/db/src/index.ts": "export {};\n",
			"apps/db/convex/tsconfig.json": convexConfig,
			"apps/db/convex/lib.ts":
				'import { Button } from "@x/ui";\nexport default Button;\n',
		});

		expect((await run(repo, [])).code).toBe(0);

		expect(repo.readJson("apps/db/package.json").dependencies).toEqual({
			"@x/ui": "workspace:*",
		});
		expect(repo.read("apps/db/convex/tsconfig.json")).toBe(convexConfig);
		expect((await run(repo, ["--check"])).code).toBe(0);
	});
});

describe("project references", () => {
	// Known bug: sync references a dependency whose tsconfig isn't composite,
	// and TypeScript then rejects the referencing tsconfig (TS6306) on the next run.
	test("a second run works after adding references (dependencies are composite)", async () => {
		const repo = repoWith({
			...UI,
			...app(
				"web",
				"web",
				'import { Button } from "@x/ui";\nconsole.log(Button);\n',
			),
		});

		expect((await run(repo, [])).code).toBe(0);
		const { code, output } = await run(repo, ["--check"]);

		expect(output).not.toContain("TS6306");
		expect(code).toBe(0);
	});

	test("a non-composite dependency is a configuration error and nothing is written", async () => {
		const repo = repoWith({
			...UI,
			"packages/ui/tsconfig.json": { include: ["src"] },
			...app(
				"web",
				"web",
				'import { Button } from "@x/ui";\nconsole.log(Button);\n',
			),
		});
		const before = contents(repo, [
			"apps/web/package.json",
			"apps/web/tsconfig.json",
		]);

		const { code, output } = await run(repo, []);

		expect(code).toBe(1);
		expect(output).toContain(
			'@x/ui: imported by web, but its tsconfig.json doesn\'t set "composite": true',
		);
		expect(
			contents(repo, ["apps/web/package.json", "apps/web/tsconfig.json"]),
		).toEqual(before);
	});
});

describe("package.json rules", () => {
	test("stale workspace dependencies are removed, devDependencies are kept", async () => {
		const repo = repoWith({
			...UI,
			...sharedPackage("packages/old", "@x/old", "export const old = 1;"),
			...sharedPackage("packages/tool", "@x/tool", "export const tool = 1;"),
			...app(
				"web",
				"web",
				'import { Button } from "@x/ui";\nconsole.log(Button);\n',
				{
					dependencies: {
						"@x/old": "workspace:*",
						"@x/ui": "workspace:*",
						lodash: "^4.0.0",
					},
					devDependencies: { "@x/tool": "workspace:*" },
				},
			),
		});

		expect((await run(repo, [])).code).toBe(0);

		const pkg = repo.readJson<{
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
		}>("apps/web/package.json");
		expect(pkg.dependencies).toEqual({
			"@x/ui": "workspace:*",
			lodash: "^4.0.0",
		});
		expect(pkg.devDependencies).toEqual({ "@x/tool": "workspace:*" });
	});

	test('workspaceDependencyVersion "*" is used for npm workspaces', async () => {
		const repo = repoWith(
			{
				...UI,
				...app(
					"web",
					"web",
					'import { Button } from "@x/ui";\nconsole.log(Button);\n',
				),
			},
			{ workspaceDependencyVersion: "*" },
		);

		expect((await run(repo, [])).code).toBe(0);
		expect(
			repo.readJson<{ dependencies: Record<string, string> }>(
				"apps/web/package.json",
			).dependencies,
		).toEqual({ "@x/ui": "*" });
	});
});

describe("circular dependencies", () => {
	const cycle = (): RepoFiles => ({
		...sharedPackage(
			"packages/a",
			"@x/a",
			'import { b } from "@x/b";\nexport const a = b;\n',
		),
		...sharedPackage(
			"packages/b",
			"@x/b",
			'import { a } from "@x/a";\nexport const b = a;\n',
		),
	});
	const watched = [
		"packages/a/package.json",
		"packages/a/tsconfig.json",
		"packages/b/package.json",
		"packages/b/tsconfig.json",
	];

	test("sync stops with exit code 2 and writes nothing", async () => {
		const repo = repoWith(cycle());
		const before = contents(repo, watched);

		const { code, output } = await run(repo, []);

		expect(code).toBe(2);
		expect(output).toMatch(/@x\/a → @x\/b → @x\/a/);
		expect(output).toContain("--force");
		expect(contents(repo, watched)).toEqual(before);
	});

	test("--force syncs anyway", async () => {
		const repo = repoWith(cycle());

		const { code } = await run(repo, ["--force"]);

		expect(code).toBe(0);
		expect(
			repo.readJson<{ dependencies: Record<string, string> }>(
				"packages/a/package.json",
			).dependencies,
		).toEqual({ "@x/b": "workspace:*" });
	});
});

describe("reporting commands", () => {
	const files = (): RepoFiles => ({
		...UI,
		// leaf imports ui, but nothing imports leaf
		...sharedPackage(
			"packages/leaf",
			"@x/leaf",
			'import { Button } from "@x/ui";\nexport const leaf = Button;\n',
		),
	});

	test("health reports cycles, diamonds and unused shared packages", async () => {
		const repo = repoWith(files());

		const { code, output } = await run(repo, ["health"]);

		expect(code).toBe(0);
		expect(output).toContain("No circular dependencies");
		expect(output).toContain(
			"Shared packages no project depends on (1): @x/leaf",
		);
	});

	test("detect-unused-exports flags packages nobody imports (incoming imports)", async () => {
		const repo = repoWith(files());

		const { code, output } = await run(repo, ["detect-unused-exports"]);

		expect(code).toBe(0);
		const leaf = output.slice(output.indexOf("📦 @x/leaf"));
		expect(leaf).toMatch(
			/^📦 @x\/leaf\n\s+🚨 Not imported by any other workspace project/,
		);
		const ui = output.slice(output.indexOf("📦 @x/ui"));
		expect(ui).toMatch(
			/^📦 @x\/ui\n\s+Imported by 1 project\(s\); 1\/2 exports used/,
		);
		expect(ui).toContain("- Unused");
	});

	test("generate-report writes serenity-now-summary.md", async () => {
		const repo = repoWith(files());

		const { code } = await run(repo, ["generate-report"]);

		expect(code).toBe(0);
		const report = repo.read("serenity-now-summary.md");
		expect(report).toContain("# Serenity Now - Monorepo Analysis Report");
		expect(report).toContain("### @x/leaf");
		expect(report).toContain("Not imported by any other workspace project");
	});
});

describe("configuration and usage errors", () => {
	test("every config file problem is listed at once", async () => {
		const repo = repoWith(UI, {
			tsconfig: { incremental: true },
			workspaceTypes: { "packages/*": { type: "library" } },
		});

		const { code, output } = await run(repo, []);

		expect(code).toBe(1);
		expect(output).toContain('"tsconfig" was removed');
		expect(output).toContain(
			'workspaceTypes["packages/*"].type must be "app" or "shared-package"',
		);
	});

	test("every workspace problem is listed at once", async () => {
		const repo = repoWith(
			{
				...UI,
				...app("web", "web", "export {};\n"),
				...app("admin", "admin", "export {};\n"),
			},
			{ workspaceTypes: { "packages/*": { type: "shared-package" } } },
		);

		const { code, output } = await run(repo, []);

		expect(code).toBe(1);
		expect(output).toContain(
			`web (apps/web) doesn't match any "workspaceTypes" pattern`,
		);
		expect(output).toContain(
			`admin (apps/admin) doesn't match any "workspaceTypes" pattern`,
		);
	});

	test("unknown commands and flags exit with 1", async () => {
		const unknownCommand = await run(undefined, ["bogus"]);
		expect(unknownCommand.code).toBe(1);
		expect(unknownCommand.output).toContain('Unknown command "bogus"');

		const unknownFlag = await run(undefined, ["--fail-on-stale"]);
		expect(unknownFlag.code).toBe(1);
		expect(unknownFlag.output).toContain("--fail-on-stale");
	});

	test("--help prints usage and exits 0", async () => {
		const { code, output } = await run(undefined, ["--help"]);
		expect(code).toBe(0);
		expect(output).toContain("Usage:");
		expect(output).toContain("detect-unused-exports");
	});

	test("a missing config file is created from the template", async () => {
		const repo = createTempRepo({
			"package.json": { name: "root", workspaces: ["packages/*"] },
		});
		repos.push(repo);

		const { code, output } = await run(repo, []);

		expect(code).toBe(1);
		expect(output).toContain("Created a config template");
		expect(existsSync(repo.path("serenity-now.config.jsonc"))).toBe(true);
	});
});
