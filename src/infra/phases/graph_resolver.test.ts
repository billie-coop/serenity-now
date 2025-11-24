import { describe, expect, it } from "vitest";
import type { FileSystemPort, LoggerPort } from "../../core/ports.js";
import type {
	ProjectInventory,
	ProjectUsage,
	RepoManagerOptions,
	SyncConfig,
} from "../../core/types.js";
import { createGraphResolver } from "./graph_resolver.js";

function createLogger(): LoggerPort {
	return {
		phase: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	};
}

function createMockFs(): FileSystemPort {
	return {
		fileExists: () => Promise.resolve(true),
		readJson: <T>() => Promise.resolve({} as T),
		writeJson: () => Promise.resolve(),
		readText: () => Promise.resolve(""),
		writeText: () => Promise.resolve(),
	};
}

const baseInventory: ProjectInventory = {
	projects: {
		app: {
			id: "app",
			root: "/repo/apps/app",
			relativeRoot: "apps/app",
			packageJson: { name: "app" },
			workspaceType: "app",
			workspaceSubType: "website",
			isPrivate: true,
		},
		shared: {
			id: "shared",
			root: "/repo/packages/shared",
			relativeRoot: "packages/shared",
			packageJson: { name: "shared" },
			workspaceType: "shared-package",
			workspaceSubType: "library",
			isPrivate: false,
		},
	},
	warnings: [],
	workspaceConfigs: {},
};

const baseUsage: ProjectUsage = {
	usage: {
		app: {
			dependencies: ["shared"],
			typeOnlyDependencies: [],
			usageDetails: [
				{
					dependencyId: "shared",
					specifier: "shared",
					isTypeOnly: false,
					sourceFile: "src/main.ts",
				},
			],
		},
	},
	warnings: [],
};

const baseConfig: SyncConfig = {};
const baseOptions: RepoManagerOptions = { rootDir: "/repo" };

describe("graph resolver", () => {
	it("links dependencies between projects", async () => {
		const resolver = createGraphResolver();

		const graph = await resolver.resolve(
			baseInventory,
			baseUsage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		const appNode = graph.projects.app;
		expect(appNode).toBeDefined();
		const sharedDep = appNode?.dependencies.shared;
		expect(sharedDep).toBeDefined();
		expect(sharedDep?.sourceFiles).toEqual(["src/main.ts"]);
	});

	it("skips external dependencies silently", async () => {
		const usage: ProjectUsage = {
			usage: {
				app: {
					dependencies: ["react", "lodash", "@types/node"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};
		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			baseInventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		expect(graph.warnings).toHaveLength(0);
		expect(Object.keys(graph.projects.app?.dependencies ?? {})).toHaveLength(0);
	});

	it("detects cycles", async () => {
		const inventory: ProjectInventory = {
			projects: {
				a: {
					id: "a",
					root: "/repo/a",
					relativeRoot: "a",
					packageJson: { name: "a" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
				b: {
					id: "b",
					root: "/repo/b",
					relativeRoot: "b",
					packageJson: { name: "b" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};
		const usage: ProjectUsage = {
			usage: {
				a: {
					dependencies: ["b"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
				b: {
					dependencies: ["a"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};

		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			inventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		expect(graph.cycles.length).toBeGreaterThan(0);
	});

	it("filters external scoped packages", async () => {
		const usage: ProjectUsage = {
			usage: {
				app: {
					dependencies: [
						"@react/core",
						"@types/node",
						"@testing-library/react",
					],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};
		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			baseInventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		expect(graph.warnings).toHaveLength(0);
		expect(Object.keys(graph.projects.app?.dependencies ?? {})).toHaveLength(0);
	});

	it("filters external unscoped packages", async () => {
		const usage: ProjectUsage = {
			usage: {
				app: {
					dependencies: ["react", "lodash", "vite"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};
		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			baseInventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		expect(graph.warnings).toHaveLength(0);
		expect(Object.keys(graph.projects.app?.dependencies ?? {})).toHaveLength(0);
	});

	it("handles deep imports to workspace packages", async () => {
		const inventory: ProjectInventory = {
			projects: {
				app: {
					id: "app",
					root: "/repo/app",
					relativeRoot: "app",
					packageJson: { name: "app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
				"@repo/utils": {
					id: "@repo/utils",
					root: "/repo/packages/utils",
					relativeRoot: "packages/utils",
					packageJson: { name: "@repo/utils" },
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
				app: {
					dependencies: [
						"@repo/utils/src/helpers",
						"@repo/utils/src/validators",
					],
					typeOnlyDependencies: [],
					usageDetails: [
						{
							sourceFile: "src/main.ts",
							dependencyId: "@repo/utils/src/helpers",
							specifier: "@repo/utils/src/helpers",
							isTypeOnly: false,
						},
						{
							sourceFile: "src/main.ts",
							dependencyId: "@repo/utils/src/validators",
							specifier: "@repo/utils/src/validators",
							isTypeOnly: false,
						},
					],
				},
			},
			warnings: [],
		};

		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			inventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		const deps = graph.projects.app?.dependencies;
		expect(Object.keys(deps ?? {})).toHaveLength(1);
		expect(deps?.["@repo/utils"]).toBeDefined();

		const utilsDep = deps?.["@repo/utils"];
		expect(utilsDep?.sourceFiles).toHaveLength(1);
		expect(utilsDep?.sourceFiles[0]).toBe("src/main.ts");
	});

	it("handles self-imports via deep paths", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"@repo/utils": {
					id: "@repo/utils",
					root: "/repo/packages/utils",
					relativeRoot: "packages/utils",
					packageJson: { name: "@repo/utils" },
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
				"@repo/utils": {
					dependencies: ["@repo/utils/src/internal"],
					typeOnlyDependencies: [],
					usageDetails: [
						{
							sourceFile: "src/index.ts",
							dependencyId: "@repo/utils/src/internal",
							specifier: "@repo/utils/src/internal",
							isTypeOnly: false,
						},
					],
				},
			},
			warnings: [],
		};

		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			inventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		const deps = graph.projects["@repo/utils"]?.dependencies;
		expect(Object.keys(deps ?? {})).toHaveLength(0);
		expect(graph.cycles).toHaveLength(0);
	});

	it("uses fallback entry point when package has no main or exports", async () => {
		const inventory: ProjectInventory = {
			projects: {
				app: {
					id: "app",
					root: "/repo/app",
					relativeRoot: "app",
					packageJson: { name: "app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
				lib: {
					id: "lib",
					root: "/repo/lib",
					relativeRoot: "lib",
					packageJson: { name: "lib" }, // No main or exports
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
				app: {
					dependencies: ["lib"],
					typeOnlyDependencies: [],
					usageDetails: [
						{
							sourceFile: "src/main.ts",
							dependencyId: "lib",
							specifier: "lib",
							isTypeOnly: false,
						},
					],
				},
			},
			warnings: [],
		};

		const mockFs: FileSystemPort = {
			fileExists: () => Promise.resolve(false),
			readJson: <T>() => Promise.resolve({} as T),
			writeJson: () => Promise.resolve(),
			readText: () => Promise.resolve(""),
			writeText: () => Promise.resolve(),
		};

		const warnings: string[] = [];
		const logger: LoggerPort = {
			phase: () => {},
			info: () => {},
			warn: (msg) => warnings.push(msg),
			error: () => {},
			debug: () => {},
		};

		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			inventory,
			usage,
			baseConfig,
			baseOptions,
			logger,
			mockFs,
		);

		const libDep = graph.projects.app?.dependencies.lib;
		expect(libDep?.entryPoint.path).toBe("src/index.ts");
		expect(libDep?.entryPoint.exists).toBe(false);
		expect(graph.warnings.length).toBeGreaterThan(0);
		expect(
			graph.warnings.some((w) =>
				w.includes("no explicit entry point configured"),
			),
		).toBe(true);
	});

	it("detects diamond dependencies", async () => {
		const inventory: ProjectInventory = {
			projects: {
				app: {
					id: "app",
					root: "/repo/app",
					relativeRoot: "app",
					packageJson: { name: "app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
				"feature-a": {
					id: "feature-a",
					root: "/repo/feature-a",
					relativeRoot: "feature-a",
					packageJson: { name: "feature-a" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
				"feature-b": {
					id: "feature-b",
					root: "/repo/feature-b",
					relativeRoot: "feature-b",
					packageJson: { name: "feature-b" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
				shared: {
					id: "shared",
					root: "/repo/shared",
					relativeRoot: "shared",
					packageJson: { name: "shared" },
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
				app: {
					dependencies: ["feature-a", "feature-b", "shared"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
				"feature-a": {
					dependencies: ["shared"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
				"feature-b": {
					dependencies: ["shared"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};

		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			inventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		expect(graph.diamonds.length).toBeGreaterThan(0);
		const diamond = graph.diamonds[0];
		expect(diamond?.projectId).toBe("app");
		expect(diamond?.directDependency).toBe("shared");
	});

	it("excludes universal utilities from diamond detection", async () => {
		const inventory: ProjectInventory = {
			projects: {
				app: {
					id: "app",
					root: "/repo/app",
					relativeRoot: "app",
					packageJson: { name: "app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
				"feature-a": {
					id: "feature-a",
					root: "/repo/feature-a",
					relativeRoot: "feature-a",
					packageJson: { name: "feature-a" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
				"feature-b": {
					id: "feature-b",
					root: "/repo/feature-b",
					relativeRoot: "feature-b",
					packageJson: { name: "feature-b" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
				utils: {
					id: "utils",
					root: "/repo/utils",
					relativeRoot: "utils",
					packageJson: { name: "utils" },
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
				app: {
					dependencies: ["feature-a", "feature-b"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
				"feature-a": {
					dependencies: ["utils"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
				"feature-b": {
					dependencies: ["utils"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};

		const config: SyncConfig = {
			universalUtilities: ["utils"],
		};

		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			inventory,
			usage,
			config,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		expect(graph.diamonds).toHaveLength(0);
	});

	it("logs warning when warnings exist", async () => {
		const inventory: ProjectInventory = {
			projects: {
				app: {
					id: "app",
					root: "/repo/app",
					relativeRoot: "app",
					packageJson: { name: "app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
				lib: {
					id: "lib",
					root: "/repo/lib",
					relativeRoot: "lib",
					packageJson: { name: "lib" },
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
				app: {
					dependencies: ["lib"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};

		const mockFs: FileSystemPort = {
			fileExists: () => Promise.resolve(false),
			readJson: <T>() => Promise.resolve({} as T),
			writeJson: () => Promise.resolve(),
			readText: () => Promise.resolve(""),
			writeText: () => Promise.resolve(),
		};

		const warnings: string[] = [];
		const logger: LoggerPort = {
			phase: () => {},
			info: () => {},
			warn: (msg) => warnings.push(msg),
			error: () => {},
			debug: () => {},
		};

		const resolver = createGraphResolver();
		await resolver.resolve(
			inventory,
			usage,
			baseConfig,
			baseOptions,
			logger,
			mockFs,
		);

		expect(
			warnings.some((w) => w.includes("Dependency resolution produced")),
		).toBe(true);
	});

	it("detects potential layering violations in diamond patterns", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"ui-components": {
					id: "ui-components",
					root: "/repo/ui-components",
					relativeRoot: "ui-components",
					packageJson: { name: "ui-components" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
				"api-layer": {
					id: "api-layer",
					root: "/repo/api-layer",
					relativeRoot: "api-layer",
					packageJson: { name: "api-layer" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
				db: {
					id: "db",
					root: "/repo/db",
					relativeRoot: "db",
					packageJson: { name: "db" },
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
				"ui-components": {
					dependencies: ["api-layer", "db"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
				"api-layer": {
					dependencies: ["db"],
					typeOnlyDependencies: [],
					usageDetails: [],
				},
			},
			warnings: [],
		};

		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			inventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		expect(graph.diamonds.length).toBeGreaterThan(0);
		const diamond = graph.diamonds[0];
		expect(diamond?.pattern).toBe("potential-layering-violation");
		expect(diamond?.suggestion).toContain("UI layer reaching into data layer");
	});

	it("handles projects with no usage data", async () => {
		const inventory: ProjectInventory = {
			projects: {
				app: {
					id: "app",
					root: "/repo/app",
					relativeRoot: "app",
					packageJson: { name: "app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
				lib: {
					id: "lib",
					root: "/repo/lib",
					relativeRoot: "lib",
					packageJson: { name: "lib" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const usage: ProjectUsage = {
			usage: {},
			warnings: [],
		};

		const resolver = createGraphResolver();
		const graph = await resolver.resolve(
			inventory,
			usage,
			baseConfig,
			baseOptions,
			createLogger(),
			createMockFs(),
		);

		expect(Object.keys(graph.projects)).toHaveLength(2);
		expect(Object.keys(graph.projects.app?.dependencies ?? {})).toHaveLength(0);
		expect(Object.keys(graph.projects.lib?.dependencies ?? {})).toHaveLength(0);
	});
});
