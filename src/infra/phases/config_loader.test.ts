import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../../core/errors.js";
import type { JsonValue } from "../../core/types.js";
import { createCapturingLogger } from "../../test_support/logger.js";
import { createMemoryFs } from "../../test_support/memory_fs.js";
import { parseJsonc } from "../json/jsonc.js";
import { createConfigLoader, validateConfig } from "./config_loader.js";
import { CONFIG_TEMPLATE, DEFAULT_CONFIG_FILENAME } from "./config_template.js";

const MINIMAL = { workspaceTypes: { "apps/*": { type: "app" } } };

function problemsOf(raw: JsonValue): string[] {
	return validateConfig(raw).problems;
}

describe("validateConfig", () => {
	it("normalizes optional settings to their defaults", () => {
		const { config, problems } = validateConfig(MINIMAL);
		expect(problems).toEqual([]);
		expect(config).toEqual({
			workspaceTypes: { "apps/*": { type: "app", requiresTsconfig: true } },
			workspaceDependencyVersion: "workspace:*",
			defaultDependencies: [],
			universalUtilities: [],
			ignoreProjects: [],
			ignoreImports: [],
			excludePatterns: [],
		});
	});

	it("keeps every configured value", () => {
		const { config, problems } = validateConfig({
			$schema: "./schema.json",
			workspaceTypes: {
				"packages/*": {
					type: "shared-package",
					subType: "library",
					enforceNamePrefix: "@acme/",
					packageJsonTemplate: { private: true },
					tsconfigTemplate: { extends: "../../tsconfig.base.json" },
					requiresTsconfig: false,
				},
			},
			workspaceDependencyVersion: "*",
			defaultDependencies: ["@acme/logger"],
			universalUtilities: ["@acme/types"],
			ignoreProjects: ["@acme/legacy"],
			ignoreImports: ["node:*"],
			excludePatterns: ["**/*.test.ts"],
		});
		expect(problems).toEqual([]);
		expect(config?.workspaceTypes["packages/*"]).toEqual({
			type: "shared-package",
			subType: "library",
			enforceNamePrefix: "@acme/",
			packageJsonTemplate: { private: true },
			tsconfigTemplate: { extends: "../../tsconfig.base.json" },
			requiresTsconfig: false,
		});
		expect(config?.workspaceDependencyVersion).toBe("*");
		expect(config?.defaultDependencies).toEqual(["@acme/logger"]);
		expect(config?.universalUtilities).toEqual(["@acme/types"]);
		expect(config?.ignoreProjects).toEqual(["@acme/legacy"]);
		expect(config?.ignoreImports).toEqual(["node:*"]);
		expect(config?.excludePatterns).toEqual(["**/*.test.ts"]);
	});

	it("requires an object", () => {
		expect(problemsOf([])).toEqual(["the configuration must be a JSON object"]);
		expect(validateConfig("nope").config).toBeUndefined();
	});

	it("requires workspaceTypes", () => {
		expect(problemsOf({})).toEqual(['"workspaceTypes" is required']);
	});

	it("requires at least one workspace type pattern", () => {
		expect(problemsOf({ workspaceTypes: {} })).toEqual([
			'"workspaceTypes" must define at least one pattern',
		]);
	});

	it("rejects unknown top-level keys", () => {
		expect(problemsOf({ ...MINIMAL, workspaceType: {} })).toEqual([
			'unknown option "workspaceType"',
		]);
	});

	it("rejects unknown keys inside a workspace type", () => {
		expect(
			problemsOf({
				workspaceTypes: { "apps/*": { type: "app", patterns: ["x"] } },
			}),
		).toEqual(['unknown option "workspaceTypes["apps/*"].patterns"']);
	});

	it("explains removed options", () => {
		const problems = problemsOf({
			...MINIMAL,
			tsconfig: { incremental: true },
			enforceNamePrefix: "@acme/",
		});
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain('"tsconfig" was removed');
		expect(problems[1]).toContain(
			'top-level "enforceNamePrefix" was removed; set it per entry in "workspaceTypes"',
		);
	});

	it("rejects wrongly typed top-level fields", () => {
		expect(
			problemsOf({
				workspaceTypes: [],
				workspaceDependencyVersion: 1,
				defaultDependencies: "x",
				universalUtilities: [1],
				ignoreProjects: {},
				ignoreImports: null,
				excludePatterns: [true],
			}),
		).toEqual([
			'"workspaceTypes" must be an object',
			'"workspaceDependencyVersion" must be a string',
			'"defaultDependencies" must be an array of strings',
			'"universalUtilities" must be an array of strings',
			'"ignoreProjects" must be an array of strings',
			'"ignoreImports" must be an array of strings',
			'"excludePatterns" must be an array of strings',
		]);
	});

	it("rejects wrongly typed workspace type fields", () => {
		expect(
			problemsOf({
				workspaceTypes: {
					"apps/*": {
						type: "app",
						enforceNamePrefix: 1,
						packageJsonTemplate: [],
						tsconfigTemplate: "x",
						requiresTsconfig: "yes",
					},
				},
			}),
		).toEqual([
			'"workspaceTypes["apps/*"].requiresTsconfig" must be a boolean',
			'"workspaceTypes["apps/*"].enforceNamePrefix" must be a string',
			'"workspaceTypes["apps/*"].packageJsonTemplate" must be an object',
			'"workspaceTypes["apps/*"].tsconfigTemplate" must be an object',
		]);
	});

	it("treats enforceNamePrefix: false as no prefix", () => {
		const { config, problems } = validateConfig({
			workspaceTypes: { "apps/*": { type: "app", enforceNamePrefix: false } },
		});
		expect(problems).toEqual([]);
		expect(config?.workspaceTypes["apps/*"]).toEqual({
			type: "app",
			requiresTsconfig: true,
		});
	});

	it("rejects enforceNamePrefix values other than a string or false", () => {
		for (const value of [true, 0, null, ["@acme/"]]) {
			expect(
				problemsOf({
					workspaceTypes: {
						"apps/*": { type: "app", enforceNamePrefix: value },
					},
				}),
			).toEqual([
				'"workspaceTypes["apps/*"].enforceNamePrefix" must be a string',
			]);
		}
	});

	it("requires a valid type for each workspace type", () => {
		expect(problemsOf({ workspaceTypes: { "apps/*": {} } })).toEqual([
			'"workspaceTypes["apps/*"].type" is required',
		]);
		expect(
			problemsOf({ workspaceTypes: { "apps/*": { type: "library" } } }),
		).toEqual([
			'workspaceTypes["apps/*"].type must be "app" or "shared-package"',
		]);
		expect(problemsOf({ workspaceTypes: { "apps/*": "app" } })).toEqual([
			'workspaceTypes["apps/*"] must be an object',
		]);
	});

	it("rejects an unknown subType", () => {
		const problems = problemsOf({
			workspaceTypes: { "apps/*": { type: "app", subType: "server" } },
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/subType must be one of: mobile, db/);
	});

	it("collects every problem at once", () => {
		const problems = problemsOf({
			workspaceTypes: {
				"apps/*": { type: "nope" },
				"packages/*": { type: "shared-package", extra: 1 },
			},
			defaultDependencies: "x",
			bogus: true,
		});
		expect(problems).toHaveLength(4);
	});
});

describe("createConfigLoader", () => {
	const root = "/repo";
	const defaultPath = `${root}/${DEFAULT_CONFIG_FILENAME}`;

	it("loads JSONC with comments and trailing commas", async () => {
		const fs = createMemoryFs({
			[defaultPath]: `{
	// apps
	"workspaceTypes": {
		"apps/*": { "type": "app", }, /* trailing */
	},
}`,
		});
		const logger = createCapturingLogger();
		const config = await createConfigLoader().load(
			{ rootDir: root },
			logger,
			fs,
		);
		expect(config.workspaceTypes["apps/*"]?.type).toBe("app");
		expect(logger.messages.info).toEqual([
			`Loading config from ${defaultPath}`,
		]);
	});

	it("resolves a relative --config path against the root", async () => {
		const fs = createMemoryFs({
			[`${root}/config/custom.jsonc`]: JSON.stringify(MINIMAL),
		});
		const config = await createConfigLoader().load(
			{ rootDir: root, configPath: "config/custom.jsonc" },
			createCapturingLogger(),
			fs,
		);
		expect(Object.keys(config.workspaceTypes)).toEqual(["apps/*"]);
	});

	it("accepts an absolute --config path", async () => {
		const fs = createMemoryFs({
			"/elsewhere/c.jsonc": JSON.stringify(MINIMAL),
		});
		const config = await createConfigLoader().load(
			{ rootDir: root, configPath: "/elsewhere/c.jsonc" },
			createCapturingLogger(),
			fs,
		);
		expect(config.workspaceDependencyVersion).toBe("workspace:*");
	});

	it("fails without creating a file when --config doesn't exist", async () => {
		const fs = createMemoryFs();
		await expect(
			createConfigLoader().load(
				{ rootDir: root, configPath: "missing.jsonc" },
				createCapturingLogger(),
				fs,
			),
		).rejects.toThrow(`Config file not found: ${root}/missing.jsonc`);
		expect(fs.files).toEqual({});
	});

	it("writes the template and stops when no config exists", async () => {
		const fs = createMemoryFs();
		const error = await createConfigLoader()
			.load({ rootDir: root }, createCapturingLogger(), fs)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ConfigurationError);
		expect((error as Error).message).toContain(
			`Created a config template at ${defaultPath}`,
		);
		expect(fs.files[defaultPath]).toBe(CONFIG_TEMPLATE);
	});

	it("reports the location of a syntax error", async () => {
		const fs = createMemoryFs({
			[defaultPath]: '{\n\t"workspaceTypes": {\n\t\t"apps/*": tru\n\t}\n}',
		});
		await expect(
			createConfigLoader().load({ rootDir: root }, createCapturingLogger(), fs),
		).rejects.toThrow(`${defaultPath}:3:13: invalid JSON`);
	});

	it("lists every validation problem in the error", async () => {
		const fs = createMemoryFs({
			[defaultPath]: JSON.stringify({ bogus: 1, defaultDependencies: 2 }),
		});
		const error = (await createConfigLoader()
			.load({ rootDir: root }, createCapturingLogger(), fs)
			.catch((e: unknown) => e)) as ConfigurationError;
		expect(error).toBeInstanceOf(ConfigurationError);
		expect(error.message).toContain(`Invalid configuration in ${defaultPath}`);
		expect(error.problems).toEqual([
			'unknown option "bogus"',
			'"workspaceTypes" is required',
			'"defaultDependencies" must be an array of strings',
		]);
	});
});

describe("CONFIG_TEMPLATE", () => {
	it("parses and validates", () => {
		const { config, problems } = validateConfig(
			parseJsonc(CONFIG_TEMPLATE, "template"),
		);
		expect(problems).toEqual([]);
		expect(Object.keys(config?.workspaceTypes ?? {})).toEqual([
			"apps/*",
			"packages/*",
		]);
	});
});
