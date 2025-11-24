import { describe, expect, it } from "vitest";
import type { FileSystemPort, LoggerPort } from "../../core/ports.js";
import type {
	PackageJson,
	ProjectInventory,
	RepoManagerOptions,
	ResolvedGraph,
	ResolvedProject,
	SyncConfig,
	TsConfig,
} from "../../core/types.js";
import { createChangeEmitter } from "./change_emitter.js";

class InMemoryFileSystem implements FileSystemPort {
	#files = new Map<string, string>();

	constructor(files: Record<string, string>) {
		for (const [path, content] of Object.entries(files)) {
			this.#files.set(path, content);
		}
	}

	readJson<T>(path: string): Promise<T> {
		const text = this.#files.get(path);
		if (text === undefined) {
			return Promise.reject(new Error(`Missing file: ${path}`));
		}
		return Promise.resolve(JSON.parse(text) as T);
	}

	writeJson(path: string, value: unknown): Promise<void> {
		this.#files.set(path, `${JSON.stringify(value, null, 2)}\n`);
		return Promise.resolve();
	}

	fileExists(path: string): Promise<boolean> {
		return Promise.resolve(this.#files.has(path));
	}

	readText(path: string): Promise<string> {
		const text = this.#files.get(path);
		if (text === undefined) {
			return Promise.reject(new Error(`Missing file: ${path}`));
		}
		return Promise.resolve(text);
	}

	writeText(path: string, contents: string): Promise<void> {
		this.#files.set(path, contents);
		return Promise.resolve();
	}
}

class MemoryLogger implements LoggerPort {
	infos: string[] = [];
	warns: string[] = [];
	phase(): void {}
	info(message: string): void {
		this.infos.push(message);
	}
	warn(message: string): void {
		this.warns.push(message);
	}
	error(): void {}
	debug(_message?: string): void {}
}

function createGraph(): ResolvedGraph {
	const projectApp: ResolvedProject = {
		project: baseInventory.projects["@repo/app"],
		dependencies: {
			"@repo/lib": {
				dependency: baseInventory.projects["@repo/lib"],
				entryPoint: {
					path: "src/index.ts",
					exists: true,
					isTypeDefinition: false,
				},
				reason: "import",
				sourceFiles: ["src/main.ts"],
			},
		},
	};

	const projectLib: ResolvedProject = {
		project: baseInventory.projects["@repo/lib"],
		dependencies: {},
	};

	return {
		projects: {
			"@repo/app": projectApp,
			"@repo/lib": projectLib,
		},
		cycles: [],
		diamonds: [],
		warnings: [],
	};
}

const baseInventory = {
	projects: {
		"@repo/app": {
			id: "@repo/app",
			root: "/repo/apps/app",
			relativeRoot: "apps/app",
			packageJson: { name: "@repo/app" },
			workspaceType: "app",
			workspaceSubType: "website",
			isPrivate: true,
			tsconfigPath: "/repo/apps/app/tsconfig.json",
		},
		"@repo/lib": {
			id: "@repo/lib",
			root: "/repo/packages/lib",
			relativeRoot: "packages/lib",
			packageJson: { name: "@repo/lib" },
			workspaceType: "shared-package",
			workspaceSubType: "library",
			isPrivate: false,
			tsconfigPath: "/repo/packages/lib/tsconfig.json",
		},
	},
	warnings: [],
	workspaceConfigs: {},
} as const satisfies ProjectInventory;

const baseConfig: SyncConfig = {};

describe("change emitter", () => {
	it("updates package and tsconfig files", async () => {
		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				dependencies: { lodash: "^4.0.0" },
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: { paths: {} },
				references: [],
			}),
			"/repo/packages/lib/package.json": JSON.stringify({
				name: "@repo/lib",
				dependencies: {},
			}),
			"/repo/packages/lib/tsconfig.json": JSON.stringify({
				compilerOptions: {},
				references: [],
			}),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();
		const graph = createGraph();

		const result = await emitter.emit(
			graph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: true } as RepoManagerOptions,
			logger,
			files,
		);

		const pkgDiff = result.diffs?.["/repo/apps/app/package.json"];
		expect(pkgDiff).toBeDefined();
		expect(Object.keys(result.staleDependencies)).toHaveLength(0);
		expect(result.projectsUpdated.sort()).toEqual(["@repo/app"]);
	});

	it("records stale dependencies", async () => {
		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				dependencies: {
					"@repo/unused": "workspace:*",
				},
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {
					paths: { "@repo/unused": ["../unused/src/index.ts"] },
				},
				references: [{ path: "../unused" }],
			}),
			"/repo/packages/lib/package.json": JSON.stringify({
				name: "@repo/lib",
				dependencies: {},
			}),
			"/repo/packages/lib/tsconfig.json": JSON.stringify({
				compilerOptions: {},
				references: [],
			}),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();
		const graph = createGraph();

		const result = await emitter.emit(
			graph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: true } as RepoManagerOptions,
			logger,
			files,
		);

		expect(result.staleDependencies["@repo/app"]).toBeDefined();
		const stale = result.staleDependencies["@repo/app"];
		expect(stale?.packageJsonDeps).toEqual(["@repo/unused"]);
		expect(stale?.tsconfigPaths).toEqual(["@repo/unused"]);
		expect(stale?.tsconfigReferences).toEqual(["../unused"]);
	});

	it("substitutes template vars in packageJsonTemplate", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"@repo/app": {
					id: "@repo/app",
					root: "/repo/apps/my-app",
					relativeRoot: "apps/my-app",
					packageJson: { name: "@repo/app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
					tsconfigPath: "/repo/apps/my-app/tsconfig.json",
					workspaceConfig: {
						type: "app",
						packageJsonTemplate: {
							version: "1.0.0-{{projectDir}}",
						},
					},
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const projectApp = {
			// biome-ignore lint/style/noNonNullAssertion: test data is known to exist
			project: inventory.projects["@repo/app"]!,
			dependencies: {},
		};

		const graph: ResolvedGraph = {
			projects: {
				"@repo/app": projectApp,
			},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const files = new InMemoryFileSystem({
			"/repo/apps/my-app/package.json": JSON.stringify({
				name: "@repo/app",
			}),
			"/repo/apps/my-app/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();

		await emitter.emit(
			graph,
			inventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		const updatedPkg = await files.readJson<{ version?: string }>(
			"/repo/apps/my-app/package.json",
		);
		expect(updatedPkg.version).toBe("1.0.0-my-app");
	});

	it("handles array templates", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"@repo/app": {
					id: "@repo/app",
					root: "/repo/apps/test-app",
					relativeRoot: "apps/test-app",
					packageJson: { name: "@repo/app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
					tsconfigPath: "/repo/apps/test-app/tsconfig.json",
					workspaceConfig: {
						type: "app",
						tsconfigTemplate: {
							include: ["src/**/*", "{{projectDir}}/**/*"],
						},
					},
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {
				"@repo/app": {
					// biome-ignore lint/style/noNonNullAssertion: test data is known to exist
					project: inventory.projects["@repo/app"]!,
					dependencies: {},
				},
			},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const files = new InMemoryFileSystem({
			"/repo/apps/test-app/package.json": JSON.stringify({
				name: "@repo/app",
			}),
			"/repo/apps/test-app/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();

		await emitter.emit(
			graph,
			inventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		const updatedTsconfig = await files.readJson<{ include?: string[] }>(
			"/repo/apps/test-app/tsconfig.json",
		);
		expect(updatedTsconfig.include).toEqual(["src/**/*", "test-app/**/*"]);
	});

	it("deep merges nested objects in templates", async () => {
		const inventory: ProjectInventory = {
			projects: {
				"@repo/app": {
					id: "@repo/app",
					root: "/repo/apps/app",
					relativeRoot: "apps/app",
					packageJson: {
						name: "@repo/app",
						dependencies: {
							"old-dep": "^1.0.0",
						},
					},
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
					tsconfigPath: "/repo/apps/app/tsconfig.json",
					workspaceConfig: {
						type: "app",
						packageJsonTemplate: {
							dependencies: {
								"new-dep": "^2.0.0",
							},
						},
					},
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const graph: ResolvedGraph = {
			projects: {
				"@repo/app": {
					// biome-ignore lint/style/noNonNullAssertion: test data is known to exist
					project: inventory.projects["@repo/app"]!,
					dependencies: {},
				},
			},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				dependencies: {
					"old-dep": "^1.0.0",
				},
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();

		await emitter.emit(
			graph,
			inventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		const updatedPkg = await files.readJson<PackageJson>(
			"/repo/apps/app/package.json",
		);
		expect(updatedPkg.dependencies?.["old-dep"]).toBe("^1.0.0");
		expect(updatedPkg.dependencies?.["new-dep"]).toBe("^2.0.0");
	});

	it("handles entry points without src/ prefix", async () => {
		const inventory = {
			projects: {
				"@repo/app": {
					id: "@repo/app",
					root: "/repo/apps/app",
					relativeRoot: "apps/app",
					packageJson: { name: "@repo/app" },
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
					tsconfigPath: "/repo/apps/app/tsconfig.json",
				},
				"@repo/lib": {
					id: "@repo/lib",
					root: "/repo/packages/lib",
					relativeRoot: "packages/lib",
					packageJson: { name: "@repo/lib" },
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
					tsconfigPath: "/repo/packages/lib/tsconfig.json",
				},
			},
			warnings: [],
			workspaceConfigs: {},
		} as const satisfies ProjectInventory;

		const graph: ResolvedGraph = {
			projects: {
				"@repo/app": {
					project: inventory.projects["@repo/app"],
					dependencies: {
						"@repo/lib": {
							dependency: inventory.projects["@repo/lib"],
							entryPoint: {
								path: "index.ts",
								exists: true,
								isTypeDefinition: false,
							},
							reason: "import",
							sourceFiles: ["src/main.ts"],
						},
					},
				},
				"@repo/lib": {
					project: inventory.projects["@repo/lib"],
					dependencies: {},
				},
			},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({ name: "@repo/app" }),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
			"/repo/packages/lib/package.json": JSON.stringify({ name: "@repo/lib" }),
			"/repo/packages/lib/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();

		await emitter.emit(
			graph,
			inventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		const updatedTsconfig = await files.readJson<TsConfig>(
			"/repo/apps/app/tsconfig.json",
		);
		expect(updatedTsconfig.compilerOptions?.paths?.["@repo/lib/*"]).toEqual([
			"../../packages/lib/*",
		]);
	});

	it("handles projects without tsconfig", async () => {
		const inventory = {
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
			warnings: [],
			workspaceConfigs: {},
		} as const satisfies ProjectInventory;

		const graph: ResolvedGraph = {
			projects: {
				"@repo/app": {
					project: inventory.projects["@repo/app"],
					dependencies: {},
				},
			},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({ name: "@repo/app" }),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();

		const result = await emitter.emit(
			graph,
			inventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		expect(result.filesModified).toBe(0);
	});

	it("warns when package.json read fails", async () => {
		const files = new InMemoryFileSystem({
			"/repo/packages/lib/package.json": JSON.stringify({ name: "@repo/lib" }),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();
		const graph = createGraph();

		const result = await emitter.emit(
			graph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: true } as RepoManagerOptions,
			logger,
			files,
		);

		expect(
			result.warnings.some((w) => w.includes("Failed to read package.json")),
		).toBe(true);
	});

	it("writes files in non-dry-run mode", async () => {
		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				dependencies: {},
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: { paths: {} },
				references: [],
			}),
			"/repo/packages/lib/package.json": JSON.stringify({
				name: "@repo/lib",
			}),
			"/repo/packages/lib/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});
		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();
		const graph = createGraph();

		const result = await emitter.emit(
			graph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		expect(result.diffs).toBeUndefined();
		expect(result.filesModified).toBe(3);

		const updatedPkg = await files.readJson<PackageJson>(
			"/repo/apps/app/package.json",
		);
		expect(updatedPkg.dependencies?.["@repo/lib"]).toBe("workspace:*");
	});

	it("logs debug messages in verbose mode", async () => {
		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				dependencies: {},
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
			"/repo/packages/lib/package.json": JSON.stringify({
				name: "@repo/lib",
			}),
			"/repo/packages/lib/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});

		class VerboseLogger extends MemoryLogger {
			debugs: string[] = [];
			override debug(message: string): void {
				this.debugs.push(message);
			}
		}

		const logger = new VerboseLogger();
		const emitter = createChangeEmitter();
		const graph = createGraph();

		await emitter.emit(
			graph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false, verbose: true } as RepoManagerOptions,
			logger,
			files,
		);

		expect(logger.debugs.some((d) => d.includes("Updated package.json"))).toBe(
			true,
		);
		expect(logger.debugs.some((d) => d.includes("Updated tsconfig.json"))).toBe(
			true,
		);
	});

	it("logs verbose stale dependencies info", async () => {
		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				dependencies: {
					"@repo/unused": "workspace:*",
				},
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {
					paths: { "@repo/unused": ["../unused/src/index.ts"] },
				},
				references: [{ path: "../unused" }],
			}),
			"/repo/packages/lib/package.json": JSON.stringify({
				name: "@repo/lib",
			}),
			"/repo/packages/lib/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});

		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();
		const graph = createGraph();

		await emitter.emit(
			graph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false, verbose: true } as RepoManagerOptions,
			logger,
			files,
		);

		expect(
			logger.infos.some((msg) => msg.includes("Stale Dependencies Detected")),
		).toBe(true);
		expect(logger.infos.some((msg) => msg.includes("package.json:"))).toBe(
			true,
		);
		expect(logger.infos.some((msg) => msg.includes("tsconfig paths:"))).toBe(
			true,
		);
		expect(
			logger.infos.some((msg) => msg.includes("tsconfig references:")),
		).toBe(true);
	});

	it("logs message when no changes needed", async () => {
		const graph = createGraph();

		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				dependencies: {
					"@repo/lib": "workspace:*",
				},
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {
					paths: {
						"@repo/lib": ["../../packages/lib/src/index.ts"],
						"@repo/lib/*": ["../../packages/lib/src/*"],
					},
				},
				references: [{ path: "../../packages/lib" }],
			}),
			"/repo/packages/lib/package.json": JSON.stringify({
				name: "@repo/lib",
			}),
			"/repo/packages/lib/tsconfig.json": JSON.stringify({
				compilerOptions: {},
				references: [],
			}),
		});

		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();

		await emitter.emit(
			graph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		expect(
			logger.infos.some((msg) =>
				msg.includes("All dependencies are already in sync"),
			),
		).toBe(true);
	});

	it("handles devDependencies when detecting stale deps", async () => {
		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				devDependencies: {
					"@repo/unused": "workspace:*",
				},
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
			"/repo/packages/lib/package.json": JSON.stringify({
				name: "@repo/lib",
			}),
			"/repo/packages/lib/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});

		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();
		const graph = createGraph();

		const result = await emitter.emit(
			graph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: true } as RepoManagerOptions,
			logger,
			files,
		);

		expect(result.staleDependencies["@repo/app"]).toBeDefined();
		expect(result.staleDependencies["@repo/app"]?.packageJsonDeps).toContain(
			"@repo/unused",
		);
	});

	it("handles empty package.json dependencies", async () => {
		const emptyGraph: ResolvedGraph = {
			projects: {
				"@repo/app": {
					project: baseInventory.projects["@repo/app"],
					dependencies: {},
				},
			},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
				dependencies: {},
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});

		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();

		await emitter.emit(
			emptyGraph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		const updatedPkg = await files.readJson<PackageJson>(
			"/repo/apps/app/package.json",
		);
		expect(updatedPkg.dependencies).toEqual({});
	});

	it("removes dependencies property when transitioning from no deps to no deps", async () => {
		const emptyGraph: ResolvedGraph = {
			projects: {
				"@repo/app": {
					project: baseInventory.projects["@repo/app"],
					dependencies: {},
				},
			},
			cycles: [],
			diamonds: [],
			warnings: [],
		};

		const files = new InMemoryFileSystem({
			"/repo/apps/app/package.json": JSON.stringify({
				name: "@repo/app",
			}),
			"/repo/apps/app/tsconfig.json": JSON.stringify({
				compilerOptions: {},
			}),
		});

		const logger = new MemoryLogger();
		const emitter = createChangeEmitter();

		await emitter.emit(
			emptyGraph,
			baseInventory,
			baseConfig,
			{ rootDir: "/repo", dryRun: false } as RepoManagerOptions,
			logger,
			files,
		);

		const updatedPkg = await files.readJson<PackageJson>(
			"/repo/apps/app/package.json",
		);
		expect(updatedPkg.dependencies).toBeUndefined();
	});
});
