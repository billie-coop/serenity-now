import { isAbsolute, join } from "node:path";
import { ConfigurationError, throwIfProblems } from "../../core/errors.js";
import { isJsonObject } from "../../core/json.js";
import type {
	ConfigLoaderPort,
	FileSystemPort,
	LoggerPort,
} from "../../core/ports.js";
import {
	type JsonObject,
	type JsonValue,
	type RepoManagerOptions,
	type SyncConfig,
	WORKSPACE_SUB_TYPES,
	type WorkspaceSubType,
	type WorkspaceTypeConfig,
} from "../../core/types.js";
import { parseJsonc } from "../json/jsonc.js";
import { CONFIG_TEMPLATE, DEFAULT_CONFIG_FILENAME } from "./config_template.js";

const REMOVED_KEYS: Record<string, string> = {
	tsconfig:
		'"tsconfig" was removed; its options (incremental, preserveOutDir, typeOnlyInDevDependencies) never had any effect',
	enforceNamePrefix:
		'top-level "enforceNamePrefix" was removed; set it per entry in "workspaceTypes"',
};

/** Validates raw config JSON, collecting every problem rather than stopping at the first. */
export function validateConfig(raw: JsonValue): {
	config?: SyncConfig;
	problems: string[];
} {
	const problems: string[] = [];
	if (!isJsonObject(raw)) {
		return { problems: ["the configuration must be a JSON object"] };
	}

	const fields = new FieldReader(raw, "", problems);
	fields.rejectUnknown(
		[
			"$schema",
			"workspaceTypes",
			"workspaceDependencyVersion",
			"defaultDependencies",
			"universalUtilities",
			"ignoreProjects",
			"ignoreImports",
			"excludePatterns",
		],
		REMOVED_KEYS,
	);

	const workspaceTypes: Record<string, WorkspaceTypeConfig> = {};
	const rawTypes = fields.object("workspaceTypes", { required: true });
	for (const [pattern, value] of Object.entries(rawTypes ?? {})) {
		const parsed = parseWorkspaceType(pattern, value, problems);
		if (parsed) workspaceTypes[pattern] = parsed;
	}
	if (rawTypes && Object.keys(rawTypes).length === 0) {
		problems.push('"workspaceTypes" must define at least one pattern');
	}

	const config: SyncConfig = {
		workspaceTypes,
		workspaceDependencyVersion:
			fields.string("workspaceDependencyVersion") ?? "workspace:*",
		defaultDependencies: fields.stringArray("defaultDependencies"),
		universalUtilities: fields.stringArray("universalUtilities"),
		ignoreProjects: fields.stringArray("ignoreProjects"),
		ignoreImports: fields.stringArray("ignoreImports"),
		excludePatterns: fields.stringArray("excludePatterns"),
	};

	return problems.length > 0 ? { problems } : { config, problems };
}

function parseWorkspaceType(
	pattern: string,
	value: JsonValue,
	problems: string[],
): WorkspaceTypeConfig | undefined {
	const field = `workspaceTypes["${pattern}"]`;
	if (!isJsonObject(value)) {
		problems.push(`${field} must be an object`);
		return undefined;
	}
	const fields = new FieldReader(value, `${field}.`, problems);
	fields.rejectUnknown([
		"type",
		"subType",
		"enforceNamePrefix",
		"packageJsonTemplate",
		"tsconfigTemplate",
		"requiresTsconfig",
	]);

	const type = fields.string("type", { required: true });
	if (type !== undefined && type !== "app" && type !== "shared-package") {
		problems.push(`${field}.type must be "app" or "shared-package"`);
		return undefined;
	}

	const subType = fields.string("subType");
	if (
		subType !== undefined &&
		!(WORKSPACE_SUB_TYPES as readonly string[]).includes(subType)
	) {
		problems.push(
			`${field}.subType must be one of: ${WORKSPACE_SUB_TYPES.join(", ")}`,
		);
	}

	const config: WorkspaceTypeConfig = {
		type: type ?? "app",
		requiresTsconfig: fields.boolean("requiresTsconfig") ?? true,
	};
	if (subType !== undefined) config.subType = subType as WorkspaceSubType;
	// `false` explicitly opts out of a prefix.
	if (value.enforceNamePrefix !== false) {
		const prefix = fields.string("enforceNamePrefix");
		if (prefix !== undefined) config.enforceNamePrefix = prefix;
	}
	const packageJsonTemplate = fields.object("packageJsonTemplate");
	if (packageJsonTemplate) config.packageJsonTemplate = packageJsonTemplate;
	const tsconfigTemplate = fields.object("tsconfigTemplate");
	if (tsconfigTemplate) config.tsconfigTemplate = tsconfigTemplate;
	return config;
}

/** Typed access to an object's fields that records a problem for each mistake. */
class FieldReader {
	constructor(
		private readonly obj: JsonObject,
		private readonly prefix: string,
		private readonly problems: string[],
	) {}

	rejectUnknown(allowed: string[], removed: Record<string, string> = {}) {
		for (const key of Object.keys(this.obj)) {
			if (allowed.includes(key)) continue;
			this.problems.push(
				removed[key] ?? `unknown option "${this.prefix}${key}"`,
			);
		}
	}

	string(key: string, opts: { required?: boolean } = {}) {
		return this.read(key, "a string", (v) => typeof v === "string", opts) as
			| string
			| undefined;
	}

	boolean(key: string) {
		return this.read(key, "a boolean", (v) => typeof v === "boolean") as
			| boolean
			| undefined;
	}

	object(key: string, opts: { required?: boolean } = {}) {
		return this.read(key, "an object", isJsonObject, opts) as
			| JsonObject
			| undefined;
	}

	stringArray(key: string): string[] {
		const value = this.read(
			key,
			"an array of strings",
			(v) => Array.isArray(v) && v.every((item) => typeof item === "string"),
		);
		return (value as string[] | undefined) ?? [];
	}

	private read(
		key: string,
		expected: string,
		check: (value: JsonValue) => boolean,
		opts: { required?: boolean } = {},
	): JsonValue | undefined {
		const value = this.obj[key];
		if (value === undefined) {
			if (opts.required) {
				this.problems.push(`"${this.prefix}${key}" is required`);
			}
			return undefined;
		}
		if (!check(value)) {
			this.problems.push(`"${this.prefix}${key}" must be ${expected}`);
			return undefined;
		}
		return value;
	}
}

export function createConfigLoader(): ConfigLoaderPort {
	return {
		async load(
			options: RepoManagerOptions,
			logger: LoggerPort,
			fs: FileSystemPort,
		): Promise<SyncConfig> {
			let configPath: string;
			if (options.configPath) {
				configPath = isAbsolute(options.configPath)
					? options.configPath
					: join(options.rootDir, options.configPath);
				if (!(await fs.fileExists(configPath))) {
					throw new ConfigurationError(`Config file not found: ${configPath}`);
				}
			} else {
				configPath = join(options.rootDir, DEFAULT_CONFIG_FILENAME);
				if (!(await fs.fileExists(configPath))) {
					await fs.writeText(configPath, CONFIG_TEMPLATE);
					throw new ConfigurationError(
						`Created a config template at ${configPath}. Customize it and rerun.`,
					);
				}
			}

			logger.info(`Loading config from ${configPath}`);
			const raw = parseJsonc(await fs.readText(configPath), configPath);
			const { config, problems } = validateConfig(raw);
			throwIfProblems(`Invalid configuration in ${configPath}`, problems);
			return config as SyncConfig;
		},
	};
}
