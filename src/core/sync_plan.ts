import { basename, dirname, join, relative, resolve } from "node:path";
import { deepMerge, isJsonObject, type JsonEdit, jsonEqual } from "./json.js";
import type {
	ChangeEntry,
	JsonObject,
	JsonValue,
	ProjectInventory,
	ResolvedProject,
	SyncConfig,
} from "./types.js";

/** The edits needed to bring one file in sync, plus a readable description of them. */
export interface FilePlan {
	edits: JsonEdit[];
	changes: ChangeEntry[];
}

/**
 * Plans package.json changes: template fields, and workspace dependencies that
 * match the project's imports.
 *
 * Only `dependencies` entries are removed. Workspace packages declared in
 * `devDependencies` or `peerDependencies` count as declared and are never
 * removed (they may be used by tooling the import scan can't see).
 */
export function planPackageJson(
	resolved: ResolvedProject,
	current: JsonObject,
	inventory: ProjectInventory,
	config: SyncConfig,
): FilePlan {
	const plan = planTemplate(
		resolved.project.workspaceConfig.packageJsonTemplate,
		current,
		resolved.project.relativeRoot,
	);
	const doc = plan.merged;
	const version = config.workspaceDependencyVersion;
	const desired = new Set(Object.keys(resolved.dependencies));
	const dependencies = stringRecord(doc.dependencies);
	const devDependencies = stringRecord(doc.devDependencies);
	const peerDependencies = stringRecord(doc.peerDependencies);

	for (const name of Object.keys(dependencies)) {
		if (inventory.projects[name] && !desired.has(name)) {
			plan.edits.push({ path: ["dependencies", name], value: undefined });
			plan.changes.push({
				action: "remove",
				description: `dependencies["${name}"] (not imported)`,
			});
		}
	}

	for (const name of [...desired].sort()) {
		if (name in peerDependencies) continue;
		const field = name in devDependencies ? "devDependencies" : "dependencies";
		const existing = (
			field === "devDependencies" ? devDependencies : dependencies
		)[name];
		if (existing === version) continue;
		plan.edits.push({
			path: [field, name],
			value: version,
			sortedInsert: true,
		});
		plan.changes.push({
			action: existing === undefined ? "add" : "update",
			description: `${field}["${name}"] = "${version}"`,
		});
	}

	return { edits: plan.edits, changes: plan.changes };
}

/**
 * Plans tsconfig.json changes: template fields, `paths` for workspace
 * dependencies, and `references` to their tsconfig projects.
 *
 * Paths and references that don't point at workspace packages are preserved.
 */
export function planTsconfig(
	resolved: ResolvedProject,
	current: JsonObject,
	tsconfigPath: string,
	inventory: ProjectInventory,
): FilePlan {
	const plan = planTemplate(
		resolved.project.workspaceConfig.tsconfigTemplate,
		current,
		resolved.project.relativeRoot,
	);
	const doc = plan.merged;
	const tsconfigDir = dirname(tsconfigPath);
	const deps = Object.values(resolved.dependencies).sort((a, b) =>
		a.dependency.id.localeCompare(b.dependency.id),
	);
	const desired = new Set(deps.map((d) => d.dependency.id));

	// paths
	const compilerOptions = isJsonObject(doc.compilerOptions)
		? doc.compilerOptions
		: {};
	const paths = isJsonObject(compilerOptions.paths)
		? compilerOptions.paths
		: {};
	for (const key of Object.keys(paths)) {
		const base = key.replace(/\/\*$/, "");
		if (inventory.projects[base] && !desired.has(base)) {
			plan.edits.push({
				path: ["compilerOptions", "paths", key],
				value: undefined,
			});
			plan.changes.push({
				action: "remove",
				description: `paths["${key}"] (not imported)`,
			});
		}
	}
	for (const dep of deps) {
		const depDir = posix(relative(tsconfigDir, dep.dependency.root));
		const entries: Array<[string, string[]]> = [
			[dep.dependency.id, [posix(join(depDir, dep.entryPoint))]],
			[
				`${dep.dependency.id}/*`,
				[posix(join(depDir, dirname(dep.entryPoint), "*"))],
			],
		];
		for (const [key, value] of entries) {
			if (jsonEqual(paths[key], value)) continue;
			plan.edits.push({
				path: ["compilerOptions", "paths", key],
				value,
				sortedInsert: true,
			});
			plan.changes.push({
				action: paths[key] === undefined ? "add" : "update",
				description: `paths["${key}"] = ${JSON.stringify(value)}`,
			});
		}
	}

	// references
	const currentRefs = Array.isArray(doc.references)
		? doc.references.filter(isJsonObject)
		: [];
	const workspaceRootFor = (refPath: string): string | undefined => {
		const target = resolve(tsconfigDir, refPath);
		return Object.values(inventory.projects).find(
			(p) => p.root === target || p.tsconfigPath === target,
		)?.id;
	};
	const otherRefs: JsonObject[] = [];
	const workspaceRefs = new Map<string, JsonObject>();
	for (const ref of currentRefs) {
		const refPath = typeof ref.path === "string" ? ref.path : "";
		const target = workspaceRootFor(refPath);
		if (target === undefined) {
			otherRefs.push(ref);
		} else if (desired.has(target)) {
			workspaceRefs.set(target, ref);
		} else {
			plan.changes.push({
				action: "remove",
				description: `reference "${refPath}" (not imported)`,
			});
		}
	}
	for (const dep of deps) {
		if (workspaceRefs.has(dep.dependency.id) || !dep.dependency.tsconfigPath) {
			continue;
		}
		const refPath = posix(relative(tsconfigDir, dep.dependency.root));
		workspaceRefs.set(dep.dependency.id, { path: refPath });
		plan.changes.push({ action: "add", description: `reference "${refPath}"` });
	}
	const nextRefs: JsonValue[] = [
		...otherRefs,
		...[...workspaceRefs.values()].sort((a, b) =>
			String(a.path).localeCompare(String(b.path)),
		),
	];
	const refsChanged =
		doc.references === undefined
			? nextRefs.length > 0
			: !jsonEqual(doc.references, nextRefs);
	if (refsChanged) {
		plan.edits.push({ path: ["references"], value: nextRefs });
	}

	return { edits: plan.edits, changes: plan.changes };
}

/**
 * Plans the edits that apply a workspace template to a document. Objects merge
 * recursively; any other value replaces what's there. `{{projectDir}}` in
 * strings becomes the project's directory name.
 */
function planTemplate(
	template: JsonObject | undefined,
	current: JsonObject,
	relativeRoot: string,
): FilePlan & { merged: JsonObject } {
	const plan: FilePlan = { edits: [], changes: [] };
	if (!template) return { ...plan, merged: current };

	const substituted = substitute(template, {
		projectDir: basename(relativeRoot),
	}) as JsonObject;

	const walk = (
		tmpl: JsonObject,
		cur: JsonValue | undefined,
		path: string[],
	): void => {
		for (const [key, value] of Object.entries(tmpl)) {
			const existing = isJsonObject(cur) ? cur[key] : undefined;
			if (isJsonObject(value) && isJsonObject(existing)) {
				walk(value, existing, [...path, key]);
			} else if (!jsonEqual(existing, value)) {
				plan.edits.push({ path: [...path, key], value });
				plan.changes.push({
					action: existing === undefined ? "add" : "update",
					description: `${[...path, key].join(".")} = ${JSON.stringify(value)} (template)`,
				});
			}
		}
	};
	walk(substituted, current, []);

	return { ...plan, merged: deepMerge(current, substituted) };
}

function substitute(value: JsonValue, vars: Record<string, string>): JsonValue {
	if (typeof value === "string") {
		return value.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
			name in vars ? (vars[name] as string) : match,
		);
	}
	if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
	if (isJsonObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]),
		);
	}
	return value;
}

function stringRecord(value: JsonValue | undefined): Record<string, string> {
	if (!isJsonObject(value)) return {};
	const result: Record<string, string> = {};
	for (const [key, v] of Object.entries(value)) {
		if (typeof v === "string") result[key] = v;
	}
	return result;
}

function posix(path: string): string {
	return path.replaceAll("\\", "/");
}
