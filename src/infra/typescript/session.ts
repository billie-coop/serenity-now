import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { globSync } from "tinyglobby";
import {
	API,
	DiagnosticCategory,
	type Project,
} from "typescript/unstable/sync";
import { ConfigurationError, throwIfProblems } from "../../core/errors.js";
import { isJsonObject } from "../../core/json.js";
import type { ProjectInfo, ProjectInventory } from "../../core/types.js";
import { createMatcher } from "../glob/patterns.js";
import { parseJsonc } from "../json/jsonc.js";

/** One tsconfig file of a workspace project, as loaded by the TypeScript API. */
export interface ConfigUnit {
	configPath: string;
	project: Project;
	/** Absolute outDir, if the config sets one. */
	outDir?: string;
	/** Absolute rootDir (TypeScript's default is the tsconfig's directory). */
	rootDir: string;
}

/** The TypeScript view of one workspace project. */
export interface ProjectSources {
	/** tsconfig.json first, then nested tsconfig.json files and configs they reference. */
	units: ConfigUnit[];
	/** Every source file the project's configs include, mapped to the config that includes it. */
	files: Map<string, ConfigUnit>;
}

export interface TypeScriptSession {
	sources: Map<string, ProjectSources>;
	close(): void;
}

/**
 * Loads every tsconfig of every workspace project through the TypeScript API:
 * the root tsconfig.json, any tsconfig.json in a subdirectory (e.g. a
 * standalone convex/tsconfig.json), and the tsconfig files those reference
 * inside the project (e.g. Vite's tsconfig.app.json).
 *
 * Nested configs are only read, never written: their files count as the
 * project's sources. A project owns the files its configs include that live
 * under its root and not under a nested workspace project. Throws a
 * ConfigurationError if any tsconfig has errors.
 */
export function openTypeScriptSession(
	inventory: ProjectInventory,
	excludePatterns: string[],
): TypeScriptSession {
	const projects = Object.values(inventory.projects);
	const owner = ownerLookup(projects);
	const isExcluded = createMatcher(excludePatterns);
	const configsByProject = new Map<string, string[]>();
	for (const project of projects) {
		const configs = projectConfigs(project, owner, isExcluded);
		if (configs.length > 0) configsByProject.set(project.id, configs);
	}

	const api = new API({});
	try {
		const snapshot = api.updateSnapshot({
			openProjects: [...configsByProject.values()].flat(),
		});
		const sources = new Map<string, ProjectSources>();
		const problems: string[] = [];

		for (const [projectId, configPaths] of configsByProject) {
			const project = inventory.projects[projectId] as ProjectInfo;
			const units: ConfigUnit[] = [];
			const files = new Map<string, ConfigUnit>();

			for (const configPath of configPaths) {
				const tsProject = snapshot.getProject(configPath);
				if (!tsProject) {
					problems.push(`${configPath}: TypeScript could not load this config`);
					continue;
				}
				// Program diagnostics include compiler options TypeScript 7 removed (baseUrl, ...).
				for (const d of [
					...tsProject.program.getConfigFileParsingDiagnostics(),
					...tsProject.program.getProgramDiagnostics(),
				]) {
					if (d.category === DiagnosticCategory.Error) {
						problems.push(
							`${d.fileName ?? configPath}: TS${d.code}: ${d.text}`,
						);
					}
				}
				const options = tsProject.compilerOptions;
				const unit: ConfigUnit = {
					configPath,
					project: tsProject,
					outDir:
						typeof options.outDir === "string" ? options.outDir : undefined,
					rootDir:
						typeof options.rootDir === "string"
							? options.rootDir
							: dirname(configPath),
				};
				units.push(unit);

				for (const file of tsProject.rootFiles) {
					if (
						files.has(file) ||
						/[\\/]node_modules[\\/]/.test(file) ||
						owner(file) !== projectId ||
						isExcluded(relative(project.root, file).replaceAll("\\", "/"))
					) {
						continue;
					}
					files.set(file, unit);
				}
			}
			sources.set(projectId, { units, files });
		}

		throwIfProblems("TypeScript configuration errors", problems);
		return { sources, close: () => api.close() };
	} catch (error) {
		api.close();
		throw error;
	}
}

/**
 * The project's tsconfig.json, then every tsconfig.json in its
 * subdirectories, then (transitively) the tsconfig files those reference
 * inside the project. References to other workspace projects are
 * dependencies, not part of this project.
 */
function projectConfigs(
	project: ProjectInfo,
	owner: (file: string) => string | undefined,
	isExcluded: (relativePath: string) => boolean,
): string[] {
	const nested = globSync("**/tsconfig.json", {
		cwd: project.root,
		ignore: ["**/node_modules/**"],
	})
		.filter((path) => !isExcluded(path))
		.sort()
		.map((path) => join(project.root, path))
		.filter((path) => owner(path) === project.id);

	const ordered: string[] = [];
	const pending = [
		...(project.tsconfigPath ? [project.tsconfigPath] : []),
		...nested,
	];
	while (pending.length > 0) {
		const configPath = pending.shift() as string;
		if (ordered.includes(configPath)) continue;
		ordered.push(configPath);

		const config = parseJsonc(readFileSync(configPath, "utf-8"), configPath);
		const references =
			isJsonObject(config) && Array.isArray(config.references)
				? config.references
				: [];
		for (const ref of references) {
			if (!isJsonObject(ref) || typeof ref.path !== "string") continue;
			const target = resolve(dirname(configPath), ref.path);
			const refConfig =
				existsSync(target) && statSync(target).isDirectory()
					? join(target, "tsconfig.json")
					: target;
			if (owner(refConfig) !== project.id) continue;
			if (!existsSync(refConfig)) {
				throw new ConfigurationError(
					`${configPath} references ${ref.path}, which does not exist`,
				);
			}
			pending.push(refConfig);
		}
	}
	return ordered;
}

/** Maps a file to the workspace project whose root most closely contains it. */
function ownerLookup(
	projects: ProjectInfo[],
): (file: string) => string | undefined {
	const byDepth = [...projects].sort((a, b) => b.root.length - a.root.length);
	return (file) => byDepth.find((p) => file.startsWith(p.root + sep))?.id;
}
