import { describe, expect, it } from "vitest";
import type { PhasePorts, RepoManagerDeps } from "./ports.js";
import { RepoManager } from "./repo_manager.js";
import { createMockLogger } from "./test-helpers.js";
import type {
	EmitResult,
	ProjectInventory,
	ProjectUsage,
	RepoManagerOptions,
	ResolvedGraph,
	SyncConfig,
} from "./types.js";

function makeTestDeps(log: string[]): RepoManagerDeps {
	const logger = createMockLogger({
		phase: (msg: string) => log.push(`phase:${msg}`),
	});

	const fileSystem = {
		readJson: <T>(_: string): Promise<T> => Promise.resolve({} as T),
		writeJson: () => Promise.resolve(),
		fileExists: () => Promise.resolve(true),
		readText: () => Promise.resolve(""),
		writeText: () => Promise.resolve(),
	};

	const phases: PhasePorts = {
		configLoader: {
			load: (options: RepoManagerOptions, _logger): Promise<SyncConfig> => {
				log.push(`config-loader:${options.rootDir}`);
				return Promise.resolve({ workspaceTypes: {} });
			},
		},
		workspaceDiscovery: {
			discover: (_config: SyncConfig): Promise<ProjectInventory> => {
				log.push("workspace-discovery");
				return Promise.resolve({
					projects: {},
					warnings: [],
					workspaceConfigs: {},
				});
			},
		},
		importScanner: {
			scan: (
				_inventory: ProjectInventory,
				_config: SyncConfig,
				_options: RepoManagerOptions,
				_logger,
				_fs,
			): Promise<ProjectUsage> => {
				log.push("import-scan");
				return Promise.resolve({ usage: {}, warnings: [] });
			},
		},
		graphResolver: {
			resolve: (): Promise<ResolvedGraph> => {
				log.push("graph-resolve");
				return Promise.resolve({
					projects: {},
					cycles: [],
					diamonds: [],
					warnings: [],
				});
			},
		},
		changeEmitter: {
			emit: (): Promise<EmitResult> => {
				log.push("change-emit");
				return Promise.resolve({
					filesModified: 0,
					projectsUpdated: [],
					staleDependencies: {},
					warnings: [],
				});
			},
		},
	};

	return { logger, fileSystem, phases };
}

describe("RepoManager", () => {
	it("orchestrates phases in order", async () => {
		const log: string[] = [];
		const deps = makeTestDeps(log);
		const manager = new RepoManager({ rootDir: "/tmp" }, deps);

		await manager.loadConfig();
		const inventory = await manager.discoverWorkspace();
		const usage = await manager.scanImports(inventory);
		const graph = await manager.resolveGraph(inventory, usage);
		const emitResult = await manager.emitChanges(graph, inventory);

		expect(emitResult.filesModified).toBe(0);
		expect(log).toEqual([
			"phase:Loading Configuration",
			"config-loader:/tmp",
			"phase:Discovering Workspace",
			"workspace-discovery",
			"phase:Scanning Imports",
			"import-scan",
			"phase:Resolving Dependency Graph",
			"graph-resolve",
			"phase:Emitting Changes",
			"change-emit",
		]);
	});

	it("enforces configuration before other phases", async () => {
		const deps = makeTestDeps([]);
		const manager = new RepoManager({ rootDir: "/tmp" }, deps);
		await expect(() => manager.discoverWorkspace()).rejects.toThrow(
			"Configuration must be loaded",
		);
	});

	it("provides access to options via getters", async () => {
		const deps = makeTestDeps([]);
		const options: RepoManagerOptions = {
			rootDir: "/test/root",
			configPath: "/test/config.json",
			dryRun: true,
			verbose: true,
			failOnStale: true,
		};
		const manager = new RepoManager(options, deps);

		expect(manager.root).toBe("/test/root");
		expect(manager.getConfigPath()).toBe("/test/config.json");
		expect(manager.isDryRun).toBe(true);
		expect(manager.isVerbose()).toBe(true);
		expect(manager.shouldFailOnStale()).toBe(true);
	});

	it("handles undefined optional options", () => {
		const deps = makeTestDeps([]);
		const options: RepoManagerOptions = {
			rootDir: "/test/root",
		};
		const manager = new RepoManager(options, deps);

		expect(manager.getConfigPath()).toBeUndefined();
		expect(manager.isDryRun).toBe(false);
		expect(manager.isVerbose()).toBe(false);
		expect(manager.shouldFailOnStale()).toBe(false);
	});

	it("returns loaded config via getConfig", async () => {
		const deps = makeTestDeps([]);
		const manager = new RepoManager({ rootDir: "/tmp" }, deps);

		await manager.loadConfig();
		const config = manager.getConfig();

		expect(config).toEqual({ workspaceTypes: {} });
	});

	it("throws when getConfig called before loading", () => {
		const deps = makeTestDeps([]);
		const manager = new RepoManager({ rootDir: "/tmp" }, deps);

		expect(() => manager.getConfig()).toThrow("Configuration must be loaded");
	});
});
