import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	FileSystemPort,
	LoggerPort,
	PhasePorts,
	RepoManagerDeps,
} from "../../core/ports.js";
import { createMockLogger } from "../../core/test-helpers.js";
import type {
	EmitResult,
	ProjectInventory,
	ProjectUsage,
	RepoManagerOptions,
	ResolvedGraph,
	SyncConfig,
} from "../../core/types.js";
import { runCli } from "./run.js";

interface FakePhaseOutputs {
	config?: SyncConfig;
	inventory?: ProjectInventory;
	usage?: ProjectUsage;
	graph?: ResolvedGraph;
	emit?: EmitResult;
}

function createFakeDeps(overrides: FakePhaseOutputs = {}): {
	deps: {
		logger: LoggerPort;
		fileSystem: FileSystemPort;
		phases: PhasePorts;
	};
	warnings: string[];
} {
	const warnings: string[] = [];

	const logger = createMockLogger({
		warn: (message: string) => {
			warnings.push(message);
		},
		getWarnings: () => [...warnings],
	});

	const fileSystem = {
		readJson: <T>() => Promise.resolve({} as T),
		writeJson: () => Promise.resolve(),
		fileExists: () => Promise.resolve(true),
		readText: () => Promise.resolve(""),
		writeText: () => Promise.resolve(),
	};

	const config: SyncConfig = overrides.config ?? { workspaceTypes: {} };
	const inventory: ProjectInventory = overrides.inventory ?? {
		projects: {},
		warnings: ["inventory warning"],
		workspaceConfigs: {},
	};
	const usage: ProjectUsage = overrides.usage ?? {
		usage: {},
		warnings: ["usage warning"],
	};
	const graph: ResolvedGraph = overrides.graph ?? {
		projects: {},
		cycles: [],
		diamonds: [],
		warnings: ["graph warning"],
	};
	const emit: EmitResult = overrides.emit ?? {
		filesModified: 0,
		projectsUpdated: [],
		staleDependencies: {},
		warnings: ["emit warning"],
	};

	const phases = {
		configLoader: {
			load: (
				_opts: RepoManagerOptions,
				_logger: RepoManagerDeps["logger"],
				_fs: RepoManagerDeps["fileSystem"],
			): Promise<SyncConfig> =>
				Promise.resolve({
					...config,
					workspaceTypes: config.workspaceTypes ?? {},
				}),
		},
		workspaceDiscovery: {
			discover: (
				_config: SyncConfig,
				_options: RepoManagerOptions,
				_logger: RepoManagerDeps["logger"],
				_fs: RepoManagerDeps["fileSystem"],
			): Promise<ProjectInventory> => Promise.resolve(inventory),
		},
		importScanner: {
			scan: (
				_inventory: ProjectInventory,
				_config: SyncConfig,
				_options: RepoManagerOptions,
				_logger: RepoManagerDeps["logger"],
				_fs: RepoManagerDeps["fileSystem"],
			): Promise<ProjectUsage> => Promise.resolve(usage),
		},
		graphResolver: {
			resolve: (
				_inventory: ProjectInventory,
				_usage: ProjectUsage,
				_config: SyncConfig,
				_options: RepoManagerOptions,
				_logger: RepoManagerDeps["logger"],
			): Promise<ResolvedGraph> => Promise.resolve(graph),
		},
		changeEmitter: {
			emit: (
				_graph: ResolvedGraph,
				_inventory: ProjectInventory,
				_config: SyncConfig,
				_options: RepoManagerOptions,
				_logger: RepoManagerDeps["logger"],
				_fs: RepoManagerDeps["fileSystem"],
			): Promise<EmitResult> => Promise.resolve(emit),
		},
	};

	return {
		deps: {
			logger,
			fileSystem,
			phases,
		},
		warnings,
	};
}

function captureConsole() {
	const originalLog = console.log;
	const originalWarn = console.warn;
	const originalError = console.error;
	const logs: string[] = [];
	const errors: string[] = [];

	console.log = ((...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	}) as typeof console.log;

	console.warn = ((...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	}) as typeof console.warn;

	console.error = ((...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	}) as typeof console.error;

	return {
		logs,
		errors,
		restore() {
			console.log = originalLog;
			console.warn = originalWarn;
			console.error = originalError;
		},
	};
}

describe("runCli", () => {
	let consoleCapture: ReturnType<typeof captureConsole>;

	beforeEach(() => {
		consoleCapture = captureConsole();
	});

	afterEach(() => {
		consoleCapture.restore();
	});

	it("returns success with stub dependencies", async () => {
		const { deps } = createFakeDeps();
		const exitCode = await runCli([], () => deps);
		expect(exitCode).toBe(0);
		expect(consoleCapture.logs.some((line) => line.includes("Warnings"))).toBe(
			true,
		);
	});

	it("respects fail-on-stale option", async () => {
		const staleEmit: EmitResult = {
			filesModified: 0,
			projectsUpdated: [],
			warnings: [],
			staleDependencies: {
				example: {
					packageJsonDeps: ["unused"],
					tsconfigPaths: [],
					tsconfigReferences: [],
				},
			},
		};

		const { deps } = createFakeDeps({ emit: staleEmit });
		const exitCode = await runCli(["--fail-on-stale"], () => deps);
		expect(exitCode).toBe(1);
		expect(
			consoleCapture.errors.some((line) =>
				line.includes("Stale dependencies detected"),
			),
		).toBe(true);
	});

	it("exits with error code 2 when cycles detected without --force", async () => {
		const graphWithCycles: ResolvedGraph = {
			projects: {},
			cycles: [
				{
					path: ["@repo/a", "@repo/b", "@repo/a"],
					projects: [],
				},
			],
			diamonds: [],
			warnings: [],
		};

		const { deps } = createFakeDeps({ graph: graphWithCycles });
		const exitCode = await runCli([], () => deps);
		expect(exitCode).toBe(2);
		expect(
			consoleCapture.errors.some((line) =>
				line.includes("circular dependency"),
			),
		).toBe(true);
		expect(consoleCapture.errors.some((line) => line.includes("--force"))).toBe(
			true,
		);
	});

	it("continues with warning when cycles detected with --force", async () => {
		const graphWithCycles: ResolvedGraph = {
			projects: {},
			cycles: [
				{
					path: ["@repo/a", "@repo/b", "@repo/a"],
					projects: [],
				},
			],
			diamonds: [],
			warnings: [],
		};

		const { deps } = createFakeDeps({ graph: graphWithCycles });
		const exitCode = await runCli(["--force"], () => deps);
		expect(exitCode).toBe(0);
		expect(
			consoleCapture.logs.some(
				(line) => line.includes("Warning") && line.includes("circular"),
			),
		).toBe(true);
	});

	it("displays diamond dependencies in verbose mode", async () => {
		const graphWithDiamonds: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [
				{
					projectId: "@repo/app",
					directDependency: "@repo/utils",
					transitiveThrough: ["@repo/lib"],
					pattern: "universal-utility",
					suggestion:
						"This is expected - @repo/utils is designed to be used everywhere.",
				},
			],
			warnings: [],
		};

		const { deps } = createFakeDeps({ graph: graphWithDiamonds });
		const exitCode = await runCli(["--verbose"], () => deps);
		expect(exitCode).toBe(0);
		expect(
			consoleCapture.logs.some((line) => line.includes("Diamond Dependencies")),
		).toBe(true);
		expect(consoleCapture.logs.some((line) => line.includes("@repo/app"))).toBe(
			true,
		);
		expect(
			consoleCapture.logs.some((line) => line.includes("@repo/utils")),
		).toBe(true);
	});

	it("displays analytics in verbose mode", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"@repo/app": {
					id: "@repo/app",
					root: "/repo/apps/app",
					relativeRoot: "apps/app",
					packageJson: { name: "@repo/app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
				"@repo/lib": {
					id: "@repo/lib",
					root: "/repo/packages/lib",
					relativeRoot: "packages/lib",
					packageJson: { name: "@repo/lib" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const usage: ProjectUsage = {
			usage: {
				"@repo/app": {
					dependencies: ["@repo/lib"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};

		const { deps } = createFakeDeps({ inventory, usage });
		const exitCode = await runCli(["--verbose"], () => deps);
		expect(exitCode).toBe(0);
		expect(
			consoleCapture.logs.some((line) => line.includes("Import Analysis")),
		).toBe(true);
		expect(
			consoleCapture.logs.some((line) =>
				line.includes("Dependency Graph Analysis"),
			),
		).toBe(true);
	});

	it("displays help message with --help flag", async () => {
		const { deps } = createFakeDeps();
		const exitCode = await runCli(["--help"], () => deps);
		expect(exitCode).toBe(0);
		expect(
			consoleCapture.logs.some((line) => line.includes("serenity-now")),
		).toBe(true);
		expect(consoleCapture.logs.some((line) => line.includes("--dry-run"))).toBe(
			true,
		);
		expect(consoleCapture.logs.some((line) => line.includes("--verbose"))).toBe(
			true,
		);
	});

	it("displays health report with --health flag", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"@repo/app": {
					id: "@repo/app",
					root: "/repo/apps/app",
					relativeRoot: "apps/app",
					packageJson: { name: "@repo/app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
			},
			warnings: ["Project @repo/app at apps/app is missing tsconfig.json"],
			workspaceConfigs: {},
		};

		const graphWithDiamonds: ResolvedGraph = {
			projects: {},
			cycles: [],
			diamonds: [
				{
					projectId: "@repo/app",
					directDependency: "@repo/lib",
					transitiveThrough: ["@repo/ui"],
					pattern: "incomplete-abstraction",
					suggestion: "Consider refactoring",
				},
			],
			warnings: [],
		};

		const config: SyncConfig = {
			workspaceTypes: {},
			defaultDependencies: [],
		};

		const { deps } = createFakeDeps({
			config,
			inventory,
			graph: graphWithDiamonds,
		});
		const exitCode = await runCli(["--health"], () => deps);
		expect(exitCode).toBe(0);
		expect(
			consoleCapture.logs.some((line) => line.includes("Health Check")),
		).toBe(true);
		expect(
			consoleCapture.logs.some((line) => line.includes("Diamond Dependencies")),
		).toBe(true);
		expect(
			consoleCapture.logs.some((line) => line.includes("Missing tsconfig")),
		).toBe(true);
	});
});
