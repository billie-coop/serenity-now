import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileSystemPort, LoggerPort } from "../../core/ports.js";
import type {
	PackageJson,
	RepoManagerOptions,
	SyncConfig,
} from "../../core/types.js";
import { createWorkspaceDiscovery } from "./workspace_discovery.js";

class InMemoryFileSystem implements FileSystemPort {
	#files = new Map<string, string>();

	constructor(initialFiles: Record<string, string> = {}) {
		for (const [path, contents] of Object.entries(initialFiles)) {
			this.#files.set(path, contents);
		}
	}

	readJson<T>(path: string): Promise<T> {
		return Promise.resolve(JSON.parse(this.#files.get(path) ?? "{}") as T);
	}

	writeJson(): Promise<void> {
		return Promise.resolve();
	}

	fileExists(path: string): Promise<boolean> {
		return Promise.resolve(this.#files.has(path));
	}

	readText(path: string): Promise<string> {
		return Promise.resolve(this.#files.get(path) ?? "");
	}

	writeText(): Promise<void> {
		return Promise.resolve();
	}
}

function createLogger(): LoggerPort & { infos: string[]; warnings: string[] } {
	const infos: string[] = [];
	const warnings: string[] = [];
	return {
		infos,
		warnings,
		phase: () => {},
		info: (msg) => infos.push(msg),
		warn: (msg) => warnings.push(msg),
		error: () => {},
		debug: () => {},
		getWarnings: () => [...warnings],
	};
}

function setupRepo(files: Record<string, unknown>): InMemoryFileSystem {
	const serialized: Record<string, string> = {};
	for (const [path, contents] of Object.entries(files)) {
		serialized[path] =
			typeof contents === "string" ? contents : JSON.stringify(contents);
	}
	return new InMemoryFileSystem(serialized);
}

const baseOptions: RepoManagerOptions = {
	rootDir: "/repo",
};

const baseConfig: SyncConfig = {
	workspaceTypes: {
		"apps/*": { type: "app", subType: "website" },
		"packages/*": { type: "shared-package" },
	},
};

type GlobMap = Record<string, string[]>;

function createStubGlob(map: GlobMap) {
	return async function* (pattern: string) {
		for (const path of map[pattern] ?? []) {
			yield {
				path,
				name: path.split("/").pop() ?? "",
				isFile: true,
			};
		}
	};
}

function workspaceGlobPattern(pattern: string): string {
	const searchPattern = pattern.includes("*") ? pattern : `${pattern}/*`;
	return join(baseOptions.rootDir, searchPattern, "package.json");
}

describe("workspace discovery", () => {
	it("finds projects matching config", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*", "packages/*"],
			} satisfies PackageJson,
			"/repo/apps/web/package.json": {
				name: "@repo/webapp",
				private: true,
			} satisfies PackageJson,
			"/repo/apps/web/tsconfig.json": "{}",
			"/repo/packages/lib/package.json": {
				name: "@repo/lib",
			} satisfies PackageJson,
			"/repo/packages/lib/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
			[workspaceGlobPattern("packages/*")]: ["/repo/packages/lib/package.json"],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(2);
		const webProject = inventory.projects["@repo/webapp"];
		const libProject = inventory.projects["@repo/lib"];
		expect(webProject).toBeDefined();
		expect(libProject).toBeDefined();
		expect(webProject?.workspaceType).toBe("app");
		expect(libProject?.workspaceType).toBe("shared-package");
		expect(inventory.warnings).toHaveLength(0);
	});

	it("warns about missing tsconfig and unmatched projects", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/app1/package.json": {
				name: "@repo/app1",
			} satisfies PackageJson,
			"/repo/apps/app1/tsconfig.json": "{}",
			"/repo/apps/no-config/package.json": {
				name: "@repo/no-config",
			} satisfies PackageJson,
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: [
				"/repo/apps/app1/package.json",
				"/repo/apps/no-config/package.json",
			],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const customConfig: SyncConfig = {
			workspaceTypes: {
				"apps/app1": { type: "app", subType: "website" },
			},
		};

		const inventory = await discovery.discover(
			customConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.warnings.some((w) => w.includes("missing tsconfig"))).toBe(
			true,
		);
		expect(
			inventory.warnings.some((w) =>
				w.includes("does not match any configured workspace type"),
			),
		).toBe(true);
	});

	it("throws when root package.json missing", async () => {
		const fs = new InMemoryFileSystem();
		const logger = createLogger();
		const discovery = createWorkspaceDiscovery(createStubGlob({}));
		await expect(() =>
			discovery.discover(baseConfig, baseOptions, logger, fs),
		).rejects.toThrow("No package.json found");
	});

	it("handles workspaces.packages format", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: {
					packages: ["apps/*", "packages/*"],
				},
			} satisfies { workspaces: { packages: string[] } },
			"/repo/apps/web/package.json": {
				name: "@repo/webapp",
			} satisfies PackageJson,
			"/repo/apps/web/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
			[workspaceGlobPattern("packages/*")]: [],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.projects["@repo/webapp"]).toBeDefined();
	});

	it("handles null workspaces gracefully", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				name: "root",
				workspaces: null,
			} satisfies { name: string; workspaces: null },
		});
		const logger = createLogger();
		const discovery = createWorkspaceDiscovery(createStubGlob({}));

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(0);
		expect(
			logger.warnings.some((w) => w.includes("No workspaces configured")),
		).toBe(true);
	});

	it("handles undefined workspaces", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				name: "root",
			} satisfies PackageJson,
		});
		const logger = createLogger();
		const discovery = createWorkspaceDiscovery(createStubGlob({}));

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(0);
		expect(
			logger.warnings.some((w) => w.includes("No workspaces configured")),
		).toBe(true);
	});

	it("skips projects in ignoreProjects config", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/app1/package.json": {
				name: "@repo/app1",
			} satisfies PackageJson,
			"/repo/apps/app1/tsconfig.json": "{}",
			"/repo/apps/ignored/package.json": {
				name: "@repo/ignored",
			} satisfies PackageJson,
			"/repo/apps/ignored/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: [
				"/repo/apps/app1/package.json",
				"/repo/apps/ignored/package.json",
			],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const configWithIgnore: SyncConfig = {
			...baseConfig,
			ignoreProjects: ["@repo/ignored"],
		};

		const inventory = await discovery.discover(
			configWithIgnore,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.projects["@repo/app1"]).toBeDefined();
		expect(inventory.projects["@repo/ignored"]).toBeUndefined();
	});

	it("warns about missing package name", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/no-name/package.json": {
				version: "1.0.0",
			} satisfies { version: string },
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/no-name/package.json"],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(0);
		expect(
			inventory.warnings.some(
				(w) =>
					w.includes("Skipping project") && w.includes("missing package name"),
			),
		).toBe(true);
	});

	it("skips non-file entries from glob", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/web/package.json": {
				name: "@repo/web",
			} satisfies PackageJson,
			"/repo/apps/web/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = async function* (_pattern: string) {
			yield {
				path: "/repo/apps/web/package.json",
				name: "package.json",
				isFile: true,
			};
			yield {
				path: "/repo/apps/directory",
				name: "directory",
				isFile: false,
			};
			yield {
				path: "/repo/apps/web/tsconfig.json",
				name: "tsconfig.json",
				isFile: true,
			};
		};
		const discovery = createWorkspaceDiscovery(globber);

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.projects["@repo/web"]).toBeDefined();
	});

	it("skips paths outside repo root", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/web/package.json": {
				name: "@repo/web",
			} satisfies PackageJson,
			"/repo/apps/web/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = async function* (_pattern: string) {
			yield {
				path: "/repo/apps/web/package.json",
				name: "package.json",
				isFile: true,
			};
			yield {
				path: "/outside/package.json",
				name: "package.json",
				isFile: true,
			};
		};
		const discovery = createWorkspaceDiscovery(globber);

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.projects["@repo/web"]).toBeDefined();
	});

	it("handles non-glob workspace patterns", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["specific-app"],
			} satisfies PackageJson,
			"/repo/specific-app/web/package.json": {
				name: "@repo/web",
			} satisfies PackageJson,
			"/repo/specific-app/web/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[join(baseOptions.rootDir, "specific-app/*", "package.json")]: [
				"/repo/specific-app/web/package.json",
			],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const customConfig: SyncConfig = {
			workspaceTypes: {
				"specific-app/web": { type: "app", subType: "website" },
			},
		};

		const inventory = await discovery.discover(
			customConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.projects["@repo/web"]).toBeDefined();
	});

	it("handles projects without workspace type config", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/web/package.json": {
				name: "@repo/web",
			} satisfies PackageJson,
			"/repo/apps/web/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const emptyConfig: SyncConfig = {};

		const inventory = await discovery.discover(
			emptyConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(
			inventory.warnings.some((w) =>
				w.includes("does not match any configured workspace type"),
			),
		).toBe(true);
	});

	it("validates name prefix when configured", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/web/package.json": {
				name: "wrong-prefix",
			} satisfies PackageJson,
			"/repo/apps/web/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const configWithPrefix: SyncConfig = {
			workspaceTypes: {
				"apps/*": { type: "app", enforceNamePrefix: "@repo/" },
			},
		};

		const inventory = await discovery.discover(
			configWithPrefix,
			baseOptions,
			logger,
			fs,
		);

		expect(
			inventory.warnings.some((w) => w.includes('should start with "@repo/"')),
		).toBe(true);
	});

	it("handles missing package.json gracefully", async () => {
		class FailingFileSystem extends InMemoryFileSystem {
			override async readJson<T>(path: string): Promise<T> {
				if (path === "/repo/apps/failing/package.json") {
					throw new Error("Read error");
				}
				return super.readJson(path);
			}
		}

		const fs = new FailingFileSystem({
			"/repo/package.json": JSON.stringify({
				workspaces: ["apps/*"],
			}),
			"/repo/apps/good/package.json": JSON.stringify({
				name: "@repo/good",
			}),
			"/repo/apps/good/tsconfig.json": "{}",
		});

		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: [
				"/repo/apps/good/package.json",
				"/repo/apps/failing/package.json",
			],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.projects["@repo/good"]).toBeDefined();
	});

	it("handles projects with requiresTsconfig set to false", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/web/package.json": {
				name: "@repo/web",
			} satisfies PackageJson,
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const configNoTsconfig: SyncConfig = {
			workspaceTypes: {
				"apps/*": { type: "app", requiresTsconfig: false },
			},
		};

		const inventory = await discovery.discover(
			configNoTsconfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.warnings.some((w) => w.includes("missing tsconfig"))).toBe(
			false,
		);
	});

	it("uses default globber when none provided", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
		});
		const logger = createLogger();
		const discovery = createWorkspaceDiscovery();

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		// With default globber and in-memory FS, no projects will be found
		// This test ensures the default globber is created without error
		expect(inventory.projects).toBeDefined();
	});

	it("handles negated workspace patterns", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: {
					packages: ["apps/*", "!apps/excluded"],
				},
			} satisfies { workspaces: { packages: string[] } },
			"/repo/apps/web/package.json": {
				name: "@repo/web",
			} satisfies PackageJson,
			"/repo/apps/web/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(Object.keys(inventory.projects)).toHaveLength(1);
		expect(inventory.projects["@repo/web"]).toBeDefined();
	});

	it("warns when project is missing tsconfig and requiresTsconfig is true", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/web/package.json": {
				name: "@repo/web",
			} satisfies PackageJson,
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const inventory = await discovery.discover(
			baseConfig,
			baseOptions,
			logger,
			fs,
		);

		expect(
			inventory.warnings.some(
				(w) => w.includes("@repo/web") && w.includes("missing tsconfig"),
			),
		).toBe(true);
	});

	it("throws on invalid workspace type", async () => {
		const fs = setupRepo({
			"/repo/package.json": {
				workspaces: ["apps/*"],
			} satisfies PackageJson,
			"/repo/apps/web/package.json": {
				name: "@repo/web",
			} satisfies PackageJson,
			"/repo/apps/web/tsconfig.json": "{}",
		});
		const logger = createLogger();
		const globber = createStubGlob({
			[workspaceGlobPattern("apps/*")]: ["/repo/apps/web/package.json"],
		});
		const discovery = createWorkspaceDiscovery(globber);

		const invalidConfig: SyncConfig = {
			workspaceTypes: {
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid type handling
				"apps/*": { type: "invalid-type" as any },
			},
		};

		await expect(() =>
			discovery.discover(invalidConfig, baseOptions, logger, fs),
		).rejects.toThrow("Invalid workspace type");
	});
});
