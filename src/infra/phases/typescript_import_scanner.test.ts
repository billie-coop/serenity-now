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
import { createTypeScriptImportScanner } from "./typescript_import_scanner.js";

describe("TypeScript Import Scanner", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		// Clean up temp directories
		for (const dir of tempDirs) {
			await rm(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	async function createTestProject(files: Record<string, string>) {
		const tempDir = await mkdtemp(join(tmpdir(), "ts-import-test-"));
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

	it("detects regular imports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        import React from "react";
        import { useState } from "react";
        import * as Utils from "@repo/utils";
      `,
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
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		expect(usage).toBeDefined();
		expect(usage?.dependencies).toContain("react");
		expect(usage?.dependencies).toContain("@repo/utils");
	});

	it("detects type-only imports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        import type { Config } from "@repo/config";
        import { type User } from "@repo/types";
      `,
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
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		expect(usage?.typeOnlyDependencies).toContain("@repo/config");
	});

	it("tracks named imports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        import { foo, bar } from "@repo/utils";
        import * as Everything from "@repo/all";
      `,
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
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		const utilsImport = usage?.usageDetails.find(
			(u) => u.specifier === "@repo/utils",
		);
		expect(utilsImport?.namedImports).toEqual(["foo", "bar"]);

		const allImport = usage?.usageDetails.find(
			(u) => u.specifier === "@repo/all",
		);
		expect(allImport?.namedImports).toContain("*");
	});

	it("detects re-exports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export { Button } from "@repo/ui";
        export * from "@repo/components";
      `,
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
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		expect(usage?.dependencies).toContain("@repo/ui");
		expect(usage?.dependencies).toContain("@repo/components");
	});

	it("ignores relative imports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        import { helper } from "./utils";
        import React from "react";
      `,
			"src/utils.ts": "export const helper = () => {}",
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
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		expect(usage?.dependencies).toContain("react");
		expect(usage?.dependencies).not.toContain("./utils");
	});

	it("respects exclude patterns", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `import React from "react";`,
			"src/test.test.ts": `import { expect } from "vitest";`,
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

		const config: SyncConfig = {
			excludePatterns: ["**/*.test.ts"],
		};
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		expect(usage?.dependencies).toContain("react");
		expect(usage?.dependencies).not.toContain("vitest");
	});

	it("adds default dependencies", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `console.log("hello");`,
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

		const config: SyncConfig = {
			defaultDependencies: ["@repo/core"],
		};
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		expect(usage?.dependencies).toContain("@repo/core");
	});

	it("handles projects without tsconfig.json", async () => {
		const projectRoot = await createTestProject({
			"src/index.ts": `import React from "react";`,
			"package.json": JSON.stringify({ name: "@repo/app" }),
		});

		const inventory: ProjectInventory = {
			projects: {
				"@repo/app": {
					id: "@repo/app",
					root: projectRoot,
					relativeRoot: ".",
					packageJson: { name: "@repo/app" },
					// No tsconfigPath
					workspaceType: "app",
					workspaceSubType: "website",
					isPrivate: true,
				},
			},
			warnings: [],
			workspaceConfigs: {},
		};

		const config: SyncConfig = {};
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		expect(result.warnings).toEqual([
			"Failed to create TypeScript program - no valid tsconfig.json files found",
		]);
	});

	it("detects namespace re-exports", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        export * as Utils from "@repo/utils";
        export { default as Button } from "@repo/ui";
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
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/lib"];
		expect(usage?.dependencies).toContain("@repo/utils");
		expect(usage?.dependencies).toContain("@repo/ui");

		const utilsImport = usage?.usageDetails.find(
			(u) => u.specifier === "@repo/utils",
		);
		expect(utilsImport?.namedImports).toContain("*");
	});

	it("respects ignore patterns in config", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        import React from "react";
        import { test } from "vitest";
        import { helper } from "@repo/utils";
      `,
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

		const config: SyncConfig = {
			ignoreImports: ["vitest"],
		};
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		expect(usage?.dependencies).toContain("react");
		expect(usage?.dependencies).toContain("@repo/utils");
		expect(usage?.dependencies).not.toContain("vitest");
	});

	it("handles empty import clauses", async () => {
		const projectRoot = await createTestProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { skipLibCheck: true },
				include: ["src/**/*"],
			}),
			"src/index.ts": `
        import "react";
        import "@repo/styles";
      `,
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
		const scanner = createTypeScriptImportScanner();
		const result = await scanner.scan(
			inventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			nodeFileSystem,
		);

		const usage = result.usage["@repo/app"];
		expect(usage?.dependencies).toContain("react");
		expect(usage?.dependencies).toContain("@repo/styles");
	});
});
