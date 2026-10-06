import { dirname, join, posix } from "node:path";
import { glob } from "tinyglobby";
import { ConfigurationError, throwIfProblems } from "../../core/errors.js";
import { isJsonObject } from "../../core/json.js";
import type {
	FileSystemPort,
	LoggerPort,
	WorkspaceDiscoveryPort,
} from "../../core/ports.js";
import type {
	PackageJson,
	ProjectInfo,
	ProjectInventory,
	RepoManagerOptions,
	SyncConfig,
} from "../../core/types.js";
import { createMatcher } from "../glob/patterns.js";
import { parseJsonc } from "../json/jsonc.js";

/** Lists package.json files (relative to rootDir) matching the workspace globs. */
export type PackageJsonFinder = (
	rootDir: string,
	include: string[],
	exclude: string[],
) => Promise<string[]>;

const findPackageJsonFiles: PackageJsonFinder = (rootDir, include, exclude) =>
	glob(include, {
		cwd: rootDir,
		ignore: [...exclude, "**/node_modules/**"],
		onlyFiles: true,
	});

/**
 * Splits the root package.json "workspaces" field into package.json globs to
 * include and exclude ("!" patterns).
 */
export function workspaceGlobs(workspaces: PackageJson["workspaces"]): {
	include: string[];
	exclude: string[];
} {
	const patterns = Array.isArray(workspaces)
		? workspaces
		: (workspaces?.packages ?? []);
	const include: string[] = [];
	const exclude: string[] = [];
	for (const pattern of patterns) {
		if (pattern.startsWith("!")) {
			exclude.push(posix.join(pattern.slice(1), "package.json"));
		} else {
			include.push(posix.join(pattern, "package.json"));
		}
	}
	return { include, exclude };
}

export function createWorkspaceDiscovery(
	findFiles: PackageJsonFinder = findPackageJsonFiles,
): WorkspaceDiscoveryPort {
	return {
		async discover(
			config: SyncConfig,
			options: RepoManagerOptions,
			logger: LoggerPort,
			fs: FileSystemPort,
		): Promise<ProjectInventory> {
			const rootDir = options.rootDir;
			const rootPackageJsonPath = join(rootDir, "package.json");
			if (!(await fs.fileExists(rootPackageJsonPath))) {
				throw new ConfigurationError(`No package.json found in ${rootDir}`);
			}
			const rootPackageJson = await readPackageJson(fs, rootPackageJsonPath);
			const { include, exclude } = workspaceGlobs(rootPackageJson.workspaces);
			if (include.length === 0) {
				throw new ConfigurationError(
					`No "workspaces" configured in ${rootPackageJsonPath}`,
				);
			}

			const patterns = Object.entries(config.workspaceTypes).map(
				([pattern, typeConfig]) => ({
					pattern,
					typeConfig,
					matches: createMatcher([pattern]),
				}),
			);
			const isIgnored = new Set(config.ignoreProjects);
			const projects: Record<string, ProjectInfo> = {};
			const problems: string[] = [];

			const files = (await findFiles(rootDir, include, exclude)).sort();
			for (const file of files) {
				const relativeRoot = dirname(file).replaceAll("\\", "/");
				const root = join(rootDir, relativeRoot);
				let packageJson: PackageJson;
				try {
					packageJson = await readPackageJson(fs, join(root, "package.json"));
				} catch (error) {
					problems.push((error as Error).message);
					continue;
				}

				const name = packageJson.name;
				if (!name) {
					problems.push(`${relativeRoot}/package.json has no "name"`);
					continue;
				}
				if (isIgnored.has(name)) {
					logger.debug(`Ignoring project ${name}`);
					continue;
				}
				const existing = projects[name];
				if (existing) {
					problems.push(
						`Package name "${name}" is used by both ${existing.relativeRoot} and ${relativeRoot}`,
					);
					continue;
				}

				// First match in config order wins, so specific patterns go before catch-alls.
				const typeConfig = patterns.find((p) =>
					p.matches(relativeRoot),
				)?.typeConfig;
				if (!typeConfig) {
					problems.push(
						`${name} (${relativeRoot}) doesn't match any "workspaceTypes" pattern (add one, or list it in "ignoreProjects")`,
					);
					continue;
				}

				if (
					typeConfig.enforceNamePrefix &&
					!name.startsWith(typeConfig.enforceNamePrefix)
				) {
					problems.push(
						`${name} (${relativeRoot}) must be named with the prefix "${typeConfig.enforceNamePrefix}"`,
					);
				}

				const tsconfigPath = join(root, "tsconfig.json");
				const hasTsconfig = await fs.fileExists(tsconfigPath);
				if (!hasTsconfig && typeConfig.requiresTsconfig) {
					problems.push(
						`${name} (${relativeRoot}) has no tsconfig.json (set "requiresTsconfig": false for projects without TypeScript)`,
					);
				}

				projects[name] = {
					id: name,
					root,
					relativeRoot,
					packageJson,
					tsconfigPath: hasTsconfig ? tsconfigPath : undefined,
					workspaceType: typeConfig.type,
					workspaceSubType: typeConfig.subType,
					workspaceConfig: typeConfig,
					isPrivate: packageJson.private ?? false,
				};
			}

			throwIfProblems("Workspace configuration problems", problems);
			logger.info(`→ Found ${Object.keys(projects).length} projects`);
			return { projects };
		},
	};
}

async function readPackageJson(
	fs: FileSystemPort,
	path: string,
): Promise<PackageJson> {
	const value = parseJsonc(await fs.readText(path), path);
	if (!isJsonObject(value)) {
		throw new ConfigurationError(`${path} must contain a JSON object`);
	}
	return value as PackageJson;
}
