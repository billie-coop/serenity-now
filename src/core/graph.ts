import { throwIfProblems } from "./errors.js";
import type {
	Cycle,
	DiamondPattern,
	ProjectInventory,
	ResolvedDependency,
	ResolvedGraph,
	ResolvedProject,
	SourceAnalysis,
	SyncConfig,
} from "./types.js";

/**
 * Builds the workspace dependency graph from the analyzed imports.
 *
 * Throws a ConfigurationError when a configured default dependency isn't a
 * workspace package, or a dependency can't be referenced: its entry point
 * can't be resolved, or its tsconfig.json isn't composite (project
 * references require it).
 */
export function resolveGraph(
	inventory: ProjectInventory,
	analysis: SourceAnalysis,
	config: SyncConfig,
): ResolvedGraph {
	const problems: string[] = [];

	for (const dep of config.defaultDependencies) {
		if (!inventory.projects[dep]) {
			problems.push(
				`defaultDependencies contains "${dep}", which is not a workspace package`,
			);
		}
	}
	throwIfProblems("Invalid configuration", problems);

	const projects: Record<string, ResolvedProject> = {};
	const unreferenceable = new Map<string, string>();

	for (const [projectId, project] of Object.entries(inventory.projects)) {
		const scan = analysis.projects[projectId];
		if (scan?.status !== "scanned") {
			projects[projectId] = { project, scanned: false, dependencies: {} };
			continue;
		}

		const dependencies: Record<string, ResolvedDependency> = {};
		const addDependency = (
			depId: string,
			reason: ResolvedDependency["reason"],
			sourceFile?: string,
		) => {
			if (depId === projectId) return;
			const dependency = inventory.projects[depId];
			if (!dependency) return;

			const existing = dependencies[depId];
			if (existing) {
				if (sourceFile && !existing.sourceFiles.includes(sourceFile)) {
					existing.sourceFiles.push(sourceFile);
				}
				return;
			}

			const entry = analysis.entryPoints[depId];
			if (entry?.status !== "resolved") {
				unreferenceable.set(
					depId,
					entry?.reason ?? "no entry point information",
				);
				return;
			}
			if (dependency.tsconfigPath && !analysis.composite[depId]) {
				unreferenceable.set(
					depId,
					`imported by ${projectId}, but its tsconfig.json doesn't set "composite": true (project references require it)`,
				);
				return;
			}

			dependencies[depId] = {
				dependency,
				entryPoint: entry.path,
				reason,
				sourceFiles: sourceFile ? [sourceFile] : [],
			};
		};

		for (const imp of scan.imports) {
			addDependency(imp.dependencyId, "import", imp.sourceFile);
		}
		for (const depId of config.defaultDependencies) {
			addDependency(depId, "default");
		}

		projects[projectId] = { project, scanned: true, dependencies };
	}

	throwIfProblems(
		"Cannot reference these workspace dependencies",
		[...unreferenceable].map(([id, reason]) => `${id}: ${reason}`),
	);

	return {
		projects,
		cycles: detectCycles(projects),
		diamonds: detectDiamonds(projects, config),
	};
}

function detectCycles(projects: Record<string, ResolvedProject>): Cycle[] {
	const visited = new Set<string>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const cycles: Cycle[] = [];

	const visit = (projectId: string): void => {
		if (onStack.has(projectId)) {
			const start = stack.indexOf(projectId);
			cycles.push({ path: [...stack.slice(start), projectId] });
			return;
		}
		if (visited.has(projectId)) return;

		visited.add(projectId);
		stack.push(projectId);
		onStack.add(projectId);
		for (const depId of Object.keys(projects[projectId]?.dependencies ?? {})) {
			visit(depId);
		}
		stack.pop();
		onStack.delete(projectId);
	};

	for (const projectId of Object.keys(projects).sort()) {
		visit(projectId);
	}
	return cycles;
}

/** Every project reachable from `projectId` (excluding itself unless in a cycle). */
function reachableFrom(
	projectId: string,
	projects: Record<string, ResolvedProject>,
): Set<string> {
	const reached = new Set<string>();
	const pending = Object.keys(projects[projectId]?.dependencies ?? {});
	while (pending.length > 0) {
		const next = pending.pop() as string;
		if (reached.has(next)) continue;
		reached.add(next);
		pending.push(...Object.keys(projects[next]?.dependencies ?? {}));
	}
	return reached;
}

/**
 * A diamond is a direct dependency that is also reachable through another
 * direct dependency.
 */
function detectDiamonds(
	projects: Record<string, ResolvedProject>,
	config: SyncConfig,
): DiamondPattern[] {
	const universal = new Set([
		...config.universalUtilities,
		...config.defaultDependencies,
	]);
	const reachCache = new Map<string, Set<string>>();
	const reach = (id: string) => {
		let reached = reachCache.get(id);
		if (!reached) {
			reached = reachableFrom(id, projects);
			reachCache.set(id, reached);
		}
		return reached;
	};

	const diamonds: DiamondPattern[] = [];
	for (const [projectId, project] of Object.entries(projects)) {
		const direct = Object.keys(project.dependencies).sort();
		for (const dep of direct) {
			const through = direct.filter(
				(other) => other !== dep && reach(other).has(dep),
			);
			if (through.length > 0) {
				diamonds.push({
					projectId,
					directDependency: dep,
					transitiveThrough: through,
					pattern: universal.has(dep)
						? "universal-utility"
						: "incomplete-abstraction",
				});
			}
		}
	}
	return diamonds;
}
