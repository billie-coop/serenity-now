import type {
	EntryPointResolution,
	ImportedBindings,
	ProjectInfo,
	ProjectInventory,
	ProjectScan,
	ResolvedDependency,
	ResolvedGraph,
	ResolvedProject,
	SourceAnalysis,
	SyncConfig,
	WorkspaceImport,
	WorkspaceTypeConfig,
} from "../core/types.js";

export const ROOT = "/repo";

/** A complete config with every option at its default. */
export function makeConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
	return {
		workspaceTypes: {
			"apps/*": { type: "app", requiresTsconfig: true },
			"packages/*": { type: "shared-package", requiresTsconfig: true },
		},
		workspaceDependencyVersion: "workspace:*",
		defaultDependencies: [],
		universalUtilities: [],
		ignoreProjects: [],
		ignoreImports: [],
		excludePatterns: [],
		...overrides,
	};
}

/**
 * A project rooted at `/repo/<relativeRoot>` (default `packages/<name without scope>`)
 * with a tsconfig.json.
 */
export function makeProject(
	id: string,
	overrides: Partial<Omit<ProjectInfo, "workspaceConfig">> & {
		workspaceConfig?: Partial<WorkspaceTypeConfig>;
	} = {},
): ProjectInfo {
	const relativeRoot =
		overrides.relativeRoot ?? `packages/${id.split("/").pop()}`;
	const root = overrides.root ?? `${ROOT}/${relativeRoot}`;
	const workspaceType = overrides.workspaceType ?? "shared-package";
	return {
		id,
		root,
		relativeRoot,
		packageJson: { name: id },
		tsconfigPath: `${root}/tsconfig.json`,
		workspaceType,
		isPrivate: false,
		...overrides,
		workspaceConfig: {
			type: workspaceType,
			requiresTsconfig: true,
			...overrides.workspaceConfig,
		},
	};
}

export function makeInventory(projects: ProjectInfo[]): ProjectInventory {
	return { projects: Object.fromEntries(projects.map((p) => [p.id, p])) };
}

export function makeImport(
	dependencyId: string,
	overrides: Partial<WorkspaceImport> = {},
): WorkspaceImport {
	const bindings: ImportedBindings = { kind: "named", names: ["x"] };
	return {
		dependencyId,
		specifier: dependencyId,
		sourceFile: "src/index.ts",
		isTypeOnly: false,
		bindings,
		...overrides,
	};
}

/**
 * Source analysis where every project is scanned with the given imports
 * (dependency ids, or full WorkspaceImport records) and every entry point
 * resolves to src/index.ts and every tsconfig is composite unless overridden.
 */
export function makeAnalysis(
	inventory: ProjectInventory,
	imports: Record<string, Array<string | WorkspaceImport>> = {},
	overrides: {
		projects?: Record<string, ProjectScan>;
		entryPoints?: Record<string, EntryPointResolution>;
		composite?: Record<string, boolean>;
		exports?: SourceAnalysis["exports"];
	} = {},
): SourceAnalysis {
	const projects: Record<string, ProjectScan> = {};
	const entryPoints: Record<string, EntryPointResolution> = {};
	const composite: Record<string, boolean> = {};
	for (const id of Object.keys(inventory.projects)) {
		composite[id] = true;
		projects[id] = {
			status: "scanned",
			fileCount: 1,
			imports: (imports[id] ?? []).map((imp) =>
				typeof imp === "string" ? makeImport(imp) : imp,
			),
		};
		entryPoints[id] = { status: "resolved", path: "src/index.ts" };
	}
	return {
		projects: { ...projects, ...overrides.projects },
		entryPoints: { ...entryPoints, ...overrides.entryPoints },
		composite: { ...composite, ...overrides.composite },
		...(overrides.exports ? { exports: overrides.exports } : {}),
	};
}

/** A resolved project whose dependencies all use src/index.ts entry points. */
export function makeResolvedProject(
	project: ProjectInfo,
	dependencies: ProjectInfo[] = [],
	overrides: Partial<ResolvedProject> = {},
): ResolvedProject {
	return {
		project,
		scanned: true,
		dependencies: Object.fromEntries(
			dependencies.map((dep): [string, ResolvedDependency] => [
				dep.id,
				{
					dependency: dep,
					entryPoint: "src/index.ts",
					reason: "import",
					sourceFiles: ["src/index.ts"],
				},
			]),
		),
		...overrides,
	};
}

/** A graph from an adjacency list of project ids (projects must be in the inventory). */
export function makeGraph(
	inventory: ProjectInventory,
	edges: Record<string, string[]>,
	overrides: Partial<ResolvedGraph> = {},
): ResolvedGraph {
	const projects: Record<string, ResolvedProject> = {};
	for (const [id, project] of Object.entries(inventory.projects)) {
		projects[id] = makeResolvedProject(
			project,
			(edges[id] ?? []).map(
				(depId) => inventory.projects[depId] as ProjectInfo,
			),
		);
	}
	return { projects, cycles: [], diamonds: [], ...overrides };
}
