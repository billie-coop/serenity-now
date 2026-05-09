import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockLogger } from "../../core/test-helpers.js";
import type {
	ProjectInventory,
	RepoManagerOptions,
	SyncConfig,
} from "../../core/types.js";
import { nodeFileSystem } from "../fs/node_fs.js";
import { createTypeScriptExportScanner } from "./typescript_export_scanner.js";

describe("TypeScript Export Scanner", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		// Clean up temp directories
		for (const dir of tempDirs) {
			await rm(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	async function createTestProject(files: Record<string, string>) {
		const tempDir = await mkdtemp(join(tmpdir(), "ts-export-test-"));
		tempDirs.push(tempDir);

		// Write all files
		for (const [filePath, content] of Object.entries(files)) {
			const fullPath = join(tempDir, filePath);
			const dir = join(fullPath, "..");
			await mkdir(dir, { recursive: true });
			await writeFile(fullPath, content, "utf-8");
		}

		return tempDir;
	}

	it("detects named exports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export const foo = "bar";
        export function hello() { return "world"; }
        export class MyClass {}
      `,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports;
		expect(exports).toBeDefined();

		const exportNames = exports?.map((e) => e.exportName);
		expect(exportNames).toContain("foo");
		expect(exportNames).toContain("hello");
		expect(exportNames).toContain("MyClass");
	});

	it("detects default exports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export default function App() { return null; }
      `,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports;
		const defaultExport = exports?.find((e) => e.exportName === "default");

		expect(defaultExport).toBeDefined();
		expect(defaultExport?.exportType).toBe("default");
	});

	it("detects type-only exports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export type Config = { name: string };
        export interface User { id: number; }
        export const value = 42;
      `,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];

		const configExport = exports.find((e) => e.exportName === "Config");
		expect(configExport?.isTypeOnly).toBe(true);

		const userExport = exports.find((e) => e.exportName === "User");
		expect(userExport?.isTypeOnly).toBe(true);

		const valueExport = exports.find((e) => e.exportName === "value");
		expect(valueExport?.isTypeOnly).toBe(false);
	});

	it("follows re-exports from entry point", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export { Button } from "./components";
        export * from "./utils";
      `,
			"src/components.ts": `
        export const Button = () => {};
      `,
			"src/utils.ts": `
        export const helper = () => {};
        export const formatter = () => {};
      `,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);

		expect(exportNames).toContain("Button");
		expect(exportNames).toContain("helper");
		expect(exportNames).toContain("formatter");
	});

	it("only scans entry point, not all files", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export const publicApi = () => {};
      `,
			"src/internal.ts": `
        export const internalHelper = () => {};
      `,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);

		expect(exportNames).toContain("publicApi");
		expect(exportNames).not.toContain("internalHelper");
	});

	it("handles projects without entry point", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"package.json": JSON.stringify({ name: "@repo/app" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/app": {
					id: "@repo/app",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/app" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/app"]?.exports || [];
		expect(exports).toEqual([]);
	});

	it("scans from src/index.ts by default", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export const fromIndex = () => {};
      `,
			"package.json": JSON.stringify({
				name: "@repo/lib",
			}),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: {
						name: "@repo/lib",
					},
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);

		expect(exportNames).toContain("fromIndex");
	});

	it("detects namespace exports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export namespace Utils {
          export const helper = () => {};
        }
        export const normalExport = 42;
      `,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const namespaceExport = exports.find((e) => e.exportName === "Utils");
		const normalExport = exports.find((e) => e.exportName === "normalExport");

		expect(namespaceExport?.exportType).toBe("namespace");
		expect(normalExport?.exportType).toBe("named");
	});

	it("handles empty file with no exports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        // Empty file with just comments
        const internal = 42;
      `,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		expect(exports).toEqual([]);
	});

	it("handles inventory with no projects", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "ts-export-empty-"));
		tempDirs.push(tempDir);

		const inventory: ProjectInventory = {
			projects: {},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: tempDir } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		expect(result.projects).toEqual({});
		expect(result.warnings).toEqual([
			"Failed to create TypeScript program - no valid tsconfig.json files found",
		]);
	});

	it("uses package.json main field as entry point fallback", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["lib/**/*"],
			}),
			"lib/main.ts": `
        export const mainExport = () => {};
      `,
			"package.json": JSON.stringify({
				name: "@repo/lib",
				main: "lib/main.ts",
			}),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: {
						name: "@repo/lib",
						main: "lib/main.ts",
					},
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);
		expect(exportNames).toContain("mainExport");
	});

	it("handles missing source file gracefully", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"package.json": JSON.stringify({
				name: "@repo/lib",
			}),
			// No src/index.ts file exists
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		// Should return empty exports array when source file doesn't exist
		const exports = result.projects["@repo/lib"]?.exports || [];
		expect(exports).toEqual([]);
	});

	it("handles TypeScript program creation errors", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": "invalid json {",
			"src/index.ts": `export const foo = "bar";`,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		// Should handle invalid tsconfig gracefully with warning
		expect(result.warnings).toContain(
			"Failed to create TypeScript program - no valid tsconfig.json files found",
		);
	});

	it("uses package.json typings field as fallback", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["dist/**/*"],
			}),
			"dist/index.d.ts": `
        export declare const fromTypings: string;
      `,
			"package.json": JSON.stringify({
				name: "@repo/lib",
				typings: "dist/index.d.ts",
			}),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: {
						name: "@repo/lib",
						typings: "dist/index.d.ts",
					},
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);
		expect(exportNames).toContain("fromTypings");
	});

	it("uses package.json module field as fallback", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["esm/**/*"],
			}),
			"esm/index.ts": `
        export const fromModule = () => {};
      `,
			"package.json": JSON.stringify({
				name: "@repo/lib",
				module: "esm/index.ts",
			}),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: {
						name: "@repo/lib",
						module: "esm/index.ts",
					},
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);
		expect(exportNames).toContain("fromModule");
	});

	it("handles package.json exports field with string value", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["dist/**/*"],
			}),
			"dist/main.ts": `
        export const fromExportsString = () => {};
      `,
			"package.json": JSON.stringify({
				name: "@repo/lib",
				exports: "dist/main.ts",
			}),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: {
						name: "@repo/lib",
						exports: "dist/main.ts",
					},
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);
		expect(exportNames).toContain("fromExportsString");
	});

	it("handles package.json exports field with nested object", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["dist/**/*"],
			}),
			"dist/esm.ts": `
        export const fromExportsObject = () => {};
      `,
			"package.json": JSON.stringify({
				name: "@repo/lib",
				exports: {
					".": {
						import: "dist/esm.ts",
						require: "dist/cjs.js",
					},
				},
			}),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: {
						name: "@repo/lib",
						exports: {
							".": {
								import: "dist/esm.ts",
								require: "dist/cjs.js",
							},
						},
					},
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);
		expect(exportNames).toContain("fromExportsObject");
	});

	it("handles package.json exports field with top-level import", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["lib/**/*"],
			}),
			"lib/module.ts": `
        export const fromTopLevelImport = () => {};
      `,
			"package.json": JSON.stringify({
				name: "@repo/lib",
				exports: {
					import: "lib/module.ts",
					default: "lib/fallback.js",
				},
			}),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: {
						name: "@repo/lib",
						exports: {
							import: "lib/module.ts",
							default: "lib/fallback.js",
						},
					},
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];
		const exportNames = exports.map((e) => e.exportName);
		expect(exportNames).toContain("fromTopLevelImport");
	});

	it("distinguishes between re-exports and named exports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export const explicitExport = "explicit";
        export { namedReExport } from "./utils";
        export * from "./components";
      `,
			"src/utils.ts": `
        export const namedReExport = "named";
      `,
			"src/components.ts": `
        export const Button = () => {};
        export const Input = () => {};
      `,
			"package.json": JSON.stringify({ name: "@repo/lib" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/lib": {
					id: "@repo/lib",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/lib" },
					tsconfigPath: join(projectRoot, "tsconfig.json"),
					workspaceType: "shared-package",
					workspaceSubType: "library",
					isPrivate: false,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptExportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{ rootDir: projectRoot } as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const exports = result.projects["@repo/lib"]?.exports || [];

		// explicitExport is directly exported, not a re-export
		const explicitExport = exports.find(
			(e) => e.exportName === "explicitExport",
		);
		expect(explicitExport?.isReExport).toBe(false);

		// namedReExport is explicitly named in export { ... } from, not a wildcard re-export
		const namedReExport = exports.find((e) => e.exportName === "namedReExport");
		expect(namedReExport?.isReExport).toBe(false);

		// Button and Input are from export * (wildcard re-export)
		const buttonExport = exports.find((e) => e.exportName === "Button");
		expect(buttonExport?.isReExport).toBe(true);

		const inputExport = exports.find((e) => e.exportName === "Input");
		expect(inputExport?.isReExport).toBe(true);
	});
});
