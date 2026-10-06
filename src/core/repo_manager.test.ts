import { describe, expect, it } from "vitest";
import {
	makeAnalysis,
	makeConfig,
	makeInventory,
	makeProject,
	ROOT,
} from "../test_support/builders.js";
import { createCapturingLogger } from "../test_support/logger.js";
import { createMemoryFs } from "../test_support/memory_fs.js";
import type { RepoManagerDeps } from "./ports.js";
import { RepoManager } from "./repo_manager.js";
import type { EmitResult, RepoManagerOptions } from "./types.js";

const config = makeConfig();
const ui = makeProject("@acme/ui");
const web = makeProject("web", {
	relativeRoot: "apps/web",
	workspaceType: "app",
});
const inventory = makeInventory([web, ui]);
const analysis = makeAnalysis(inventory, { web: ["@acme/ui"] });
const emitResult: EmitResult = { fileChanges: [], skippedProjects: [] };

function setup(options: Partial<RepoManagerOptions> = {}) {
	const calls: Array<{ phase: string; args: unknown[] }> = [];
	const logger = createCapturingLogger();
	const fileSystem = createMemoryFs();
	const deps: RepoManagerDeps = {
		logger,
		fileSystem,
		phases: {
			configLoader: {
				load: async (...args) => {
					calls.push({ phase: "load", args });
					return config;
				},
			},
			workspaceDiscovery: {
				discover: async (...args) => {
					calls.push({ phase: "discover", args });
					return inventory;
				},
			},
			sourceAnalyzer: {
				analyze: async (...args) => {
					calls.push({ phase: "analyze", args });
					return analysis;
				},
			},
			changeEmitter: {
				emit: async (...args) => {
					calls.push({ phase: "emit", args });
					return emitResult;
				},
			},
		},
	};
	const repoOptions: RepoManagerOptions = { rootDir: ROOT, ...options };
	return {
		manager: new RepoManager(repoOptions, deps),
		calls,
		logger,
		fileSystem,
		repoOptions,
	};
}

describe("RepoManager", () => {
	it("runs the phases in order, passing the loaded config along", async () => {
		const { manager, calls, logger, fileSystem, repoOptions } = setup();

		expect(await manager.loadConfig()).toBe(config);
		const inv = await manager.discoverWorkspace();
		const result = await manager.analyzeSources(inv, { includeExports: true });
		const graph = manager.resolveGraph(inv, result);
		expect(await manager.emitChanges(graph, inv)).toBe(emitResult);

		expect(calls.map((c) => c.phase)).toEqual([
			"load",
			"discover",
			"analyze",
			"emit",
		]);
		expect(calls[0]?.args).toEqual([repoOptions, logger, fileSystem]);
		expect(calls[1]?.args).toEqual([config, repoOptions, logger, fileSystem]);
		expect(calls[2]?.args).toEqual([
			inventory,
			config,
			{ includeExports: true },
			logger,
		]);
		expect(calls[3]?.args).toEqual([
			graph,
			inventory,
			config,
			repoOptions,
			logger,
			fileSystem,
		]);

		expect(logger.messages.phase).toEqual([
			"Loading Configuration",
			"Discovering Workspace",
			"Analyzing Sources",
			"Resolving Dependency Graph",
			"Updating Files",
		]);
	});

	it("resolves the graph from the analysis", async () => {
		const { manager, logger } = setup();
		await manager.loadConfig();

		const graph = manager.resolveGraph(inventory, analysis);

		expect(Object.keys(graph.projects.web?.dependencies ?? {})).toEqual([
			"@acme/ui",
		]);
		expect(logger.messages.info).toContain(
			"→ 2 projects, 1 workspace dependencies",
		);
	});

	it("names the emit phase for a dry run", async () => {
		const { manager, logger } = setup({ dryRun: true });
		await manager.loadConfig();
		await manager.emitChanges(
			manager.resolveGraph(inventory, analysis),
			inventory,
		);
		expect(logger.messages.phase).toContain("Checking Files");
		expect(logger.messages.phase).not.toContain("Updating Files");
	});

	it("requires the config to be loaded first", async () => {
		const { manager, calls } = setup();
		const message = "Configuration must be loaded before running this phase";

		await expect(manager.discoverWorkspace()).rejects.toThrow(message);
		await expect(
			manager.analyzeSources(inventory, { includeExports: false }),
		).rejects.toThrow(message);
		expect(() => manager.resolveGraph(inventory, analysis)).toThrow(message);
		await expect(
			manager.emitChanges(
				{ projects: {}, cycles: [], diamonds: [] },
				inventory,
			),
		).rejects.toThrow(message);
		expect(calls).toEqual([]);
	});
});
