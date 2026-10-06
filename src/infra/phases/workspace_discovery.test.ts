import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../../core/errors.js";
import type { WorkspaceTypeConfig } from "../../core/types.js";
import { makeConfig, ROOT } from "../../test_support/builders.js";
import { createCapturingLogger } from "../../test_support/logger.js";
import { createMemoryFs } from "../../test_support/memory_fs.js";
import {
	createWorkspaceDiscovery,
	type PackageJsonFinder,
	workspaceGlobs,
} from "./workspace_discovery.js";

const APP: WorkspaceTypeConfig = { type: "app", requiresTsconfig: true };
const SHARED: WorkspaceTypeConfig = {
	type: "shared-package",
	requiresTsconfig: true,
};

/** A memory fs with a root package.json plus `files` (paths relative to ROOT). */
function repoFs(
	files: Record<string, string | object>,
	workspaces: unknown = ["apps/*", "packages/*"],
) {
	const all: Record<string, string> = {
		[`${ROOT}/package.json`]: JSON.stringify({ name: "root", workspaces }),
	};
	for (const [path, contents] of Object.entries(files)) {
		all[`${ROOT}/${path}`] =
			typeof contents === "string" ? contents : JSON.stringify(contents);
	}
	return createMemoryFs(all);
}

/** Finds every package.json in the memory fs except the root one. */
function finderFor(fs: { files: Record<string, string> }): PackageJsonFinder & {
	calls: Array<{ rootDir: string; include: string[]; exclude: string[] }>;
} {
	const calls: Array<{
		rootDir: string;
		include: string[];
		exclude: string[];
	}> = [];
	const finder = async (
		rootDir: string,
		include: string[],
		exclude: string[],
	) => {
		calls.push({ rootDir, include, exclude });
		return Object.keys(fs.files)
			.filter(
				(p) => p.endsWith("/package.json") && p !== `${ROOT}/package.json`,
			)
			.map((p) => p.slice(ROOT.length + 1));
	};
	return Object.assign(finder, { calls });
}

async function discover(
	fs: ReturnType<typeof createMemoryFs>,
	config = makeConfig(),
	logger = createCapturingLogger(),
) {
	return createWorkspaceDiscovery(finderFor(fs)).discover(
		config,
		{ rootDir: ROOT },
		logger,
		fs,
	);
}

async function problemsOf(
	fs: ReturnType<typeof createMemoryFs>,
	config = makeConfig(),
): Promise<string[]> {
	const error = await discover(fs, config).catch((e: unknown) => e);
	expect(error).toBeInstanceOf(ConfigurationError);
	return (error as ConfigurationError).problems;
}

describe("workspaceGlobs", () => {
	it("maps each pattern to its package.json and negations to excludes", () => {
		expect(
			workspaceGlobs(["apps/*", "packages/**", "!packages/legacy"]),
		).toEqual({
			include: ["apps/*/package.json", "packages/**/package.json"],
			exclude: ["packages/legacy/package.json"],
		});
	});

	it("treats a plain path as the package directory itself", () => {
		expect(workspaceGlobs(["tools/cli"])).toEqual({
			include: ["tools/cli/package.json"],
			exclude: [],
		});
	});

	it("reads the object form", () => {
		expect(workspaceGlobs({ packages: ["libs/*"] })).toEqual({
			include: ["libs/*/package.json"],
			exclude: [],
		});
		expect(workspaceGlobs({})).toEqual({ include: [], exclude: [] });
		expect(workspaceGlobs(undefined)).toEqual({ include: [], exclude: [] });
	});
});

describe("workspace discovery", () => {
	it("builds project info for matching projects", async () => {
		const fs = repoFs({
			"apps/web/package.json": { name: "web", private: true },
			"apps/web/tsconfig.json": "{}",
			"packages/ui/package.json": { name: "@acme/ui" },
			"packages/ui/tsconfig.json": "{}",
		});
		const logger = createCapturingLogger();
		const finder = finderFor(fs);
		const inventory = await createWorkspaceDiscovery(finder).discover(
			makeConfig({
				workspaceTypes: {
					"apps/*": { ...APP, subType: "website" },
					"packages/*": SHARED,
				},
			}),
			{ rootDir: ROOT },
			logger,
			fs,
		);

		expect(finder.calls).toEqual([
			{
				rootDir: ROOT,
				include: ["apps/*/package.json", "packages/*/package.json"],
				exclude: [],
			},
		]);
		expect(Object.keys(inventory.projects)).toEqual(["web", "@acme/ui"]);
		expect(inventory.projects.web).toEqual({
			id: "web",
			root: `${ROOT}/apps/web`,
			relativeRoot: "apps/web",
			packageJson: { name: "web", private: true },
			tsconfigPath: `${ROOT}/apps/web/tsconfig.json`,
			workspaceType: "app",
			workspaceSubType: "website",
			workspaceConfig: { ...APP, subType: "website" },
			isPrivate: true,
		});
		expect(inventory.projects["@acme/ui"]?.workspaceType).toBe(
			"shared-package",
		);
		expect(inventory.projects["@acme/ui"]?.isPrivate).toBe(false);
		expect(logger.messages.info).toEqual(["→ Found 2 projects"]);
	});

	it("allows a missing tsconfig when requiresTsconfig is false", async () => {
		const fs = repoFs({ "apps/docs/package.json": { name: "docs" } });
		const inventory = await discover(
			fs,
			makeConfig({
				workspaceTypes: { "apps/*": { ...APP, requiresTsconfig: false } },
			}),
		);
		expect(inventory.projects.docs?.tsconfigPath).toBeUndefined();
	});

	it("skips ignored projects before validating them", async () => {
		const fs = repoFs({
			"apps/web/package.json": { name: "web" },
			"apps/web/tsconfig.json": "{}",
			"legacy/old/package.json": { name: "old" },
		});
		const logger = createCapturingLogger();
		const inventory = await discover(
			fs,
			makeConfig({ ignoreProjects: ["old"] }),
			logger,
		);
		expect(Object.keys(inventory.projects)).toEqual(["web"]);
		expect(logger.messages.debug).toEqual(["Ignoring project old"]);
	});

	it("fails when the root has no package.json", async () => {
		await expect(discover(createMemoryFs())).rejects.toThrow(
			`No package.json found in ${ROOT}`,
		);
	});

	it("fails when no workspaces are configured", async () => {
		const noWorkspaces = createMemoryFs({
			[`${ROOT}/package.json`]: JSON.stringify({ name: "root" }),
		});
		await expect(discover(noWorkspaces)).rejects.toThrow(
			`No "workspaces" configured in ${ROOT}/package.json`,
		);
		await expect(discover(repoFs({}, ["!apps/x"]))).rejects.toThrow(
			ConfigurationError,
		);
	});

	it("reports every problem at once", async () => {
		const fs = repoFs({
			"apps/nameless/package.json": { version: "1.0.0" },
			"apps/broken/package.json": "{ not json",
			"apps/one/package.json": { name: "dupe" },
			"apps/one/tsconfig.json": "{}",
			"apps/two/package.json": { name: "dupe" },
			"apps/two/tsconfig.json": "{}",
			"tools/stray/package.json": { name: "stray" },
			"apps/notsc/package.json": { name: "notsc" },
		});
		const problems = await problemsOf(fs);
		expect(problems).toHaveLength(5);
		expect(problems).toEqual(
			expect.arrayContaining([
				expect.stringContaining(
					`${ROOT}/apps/broken/package.json:1:3: invalid JSON`,
				),
				'apps/nameless/package.json has no "name"',
				'Package name "dupe" is used by both apps/one and apps/two',
				expect.stringMatching(
					/^stray \(tools\/stray\) doesn't match any "workspaceTypes" pattern/,
				),
				expect.stringMatching(/^notsc \(apps\/notsc\) has no tsconfig\.json/),
			]),
		);
	});

	it("uses the first matching pattern in config order", async () => {
		const fs = repoFs({
			"apps/web/package.json": { name: "web" },
			"apps/web/tsconfig.json": "{}",
			"apps/api/package.json": { name: "api" },
			"apps/api/tsconfig.json": "{}",
		});
		const inventory = await discover(
			fs,
			makeConfig({ workspaceTypes: { "apps/web": SHARED, "apps/*": APP } }),
		);
		expect(inventory.projects.web?.workspaceType).toBe("shared-package");
		expect(inventory.projects.api?.workspaceType).toBe("app");

		const reversed = await discover(
			fs,
			makeConfig({ workspaceTypes: { "apps/*": APP, "apps/web": SHARED } }),
		);
		expect(reversed.projects.web?.workspaceType).toBe("app");
	});

	it("enforces the configured name prefix", async () => {
		const fs = repoFs({
			"packages/ui/package.json": { name: "ui" },
			"packages/ui/tsconfig.json": "{}",
			"packages/ok/package.json": { name: "@acme/ok" },
			"packages/ok/tsconfig.json": "{}",
		});
		const problems = await problemsOf(
			fs,
			makeConfig({
				workspaceTypes: {
					"packages/*": { ...SHARED, enforceNamePrefix: "@acme/" },
				},
			}),
		);
		expect(problems).toEqual([
			'ui (packages/ui) must be named with the prefix "@acme/"',
		]);
	});

	it("rejects a package.json that isn't an object", async () => {
		const fs = repoFs({ "apps/arr/package.json": "[]" });
		const problems = await problemsOf(fs);
		expect(problems).toEqual([
			`${ROOT}/apps/arr/package.json must contain a JSON object`,
		]);
	});
});
