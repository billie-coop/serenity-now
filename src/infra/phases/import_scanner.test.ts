import { describe, expect, it } from "vitest";
import type { FileSystemPort } from "../../core/ports.js";
import { createMockLogger } from "../../core/test-helpers.js";
import type {
	ProjectInventory,
	RepoManagerOptions,
	SyncConfig,
} from "../../core/types.js";
import { createImportScanner } from "./import_scanner.js";

class InMemoryFileSystem implements FileSystemPort {
	#files = new Map<string, string>();

	constructor(files: Record<string, string>) {
		for (const [path, content] of Object.entries(files)) {
			this.#files.set(path, content);
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

const baseInventory: ProjectInventory = {
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
};

const baseConfig: SyncConfig = {
	defaultDependencies: [],
};

function createWalker(entries: Array<{ path: string }>) {
	return async function* (_root: string) {
		for (const entry of entries) {
			yield { path: entry.path, isFile: true };
		}
	};
}

describe("import scanner", () => {
	it("captures dependencies", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      import React from "react";
      import type { Config } from "@types/config";
      export { something } from "@repo/shared";
      const module = await import("@repo/dynamic");
      const data = require("@repo/legacy");
      import "./local";
    `,
		});

		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies.sort()).toEqual([
			"@repo/dynamic",
			"@repo/legacy",
			"@repo/shared",
			"react",
		]);
		expect(record?.typeOnlyDependencies).toEqual(["@types/config"]);
		expect(record?.usageDetails).toHaveLength(5);
	});

	it("respects ignore list and defaults", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      import foo from "foo";
      import bar from "@internal/bar";
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const config: SyncConfig = {
			ignoreImports: ["@internal/bar"],
			defaultDependencies: ["@repo/env"],
		};

		const usage = await scanner.scan(
			baseInventory,
			config,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies.sort()).toEqual(["@repo/env", "foo"]);
	});

	it("ignores imports in single-line comments", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      // import { Foo } from '@billie-coop/should-ignore';
      // NOTE: RenderedInvoice type moved to @billie-coop/data-sync-lite-invoice
      import { Bar } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("ignores imports in multi-line comments", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      /*
       * import { Foo } from '@billie-coop/should-ignore';
       * This is a comment
       */
      import { Bar } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("handles webpack magic comments", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      import(/* webpackChunkName: "foo" */ './dynamic');
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual([]);
	});

	it("preserves URLs and comment-like content in strings", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      const url = "http://example.com";
      const str = "/* not a comment */";
      import { Foo } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("handles escaped quotes in strings", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      const str = "He said \\"hello\\"";
      import { Foo } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("handles template literals with expressions", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      const str = \`Hello \${name}\`;
      import { Foo } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("handles escaped backticks in template literals", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      const str = \`Code: \\\`foo\\\`\`;
      import { Foo } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("handles newlines in comments", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      // Comment line 1
      // Comment line 2
      import { Foo } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("handles newlines in multi-line comments", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      /* Line 1
         Line 2
         Line 3 */
      import { Foo } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("warns when file read fails", async () => {
		class FailingFileSystem extends InMemoryFileSystem {
			override async readText(path: string): Promise<string> {
				if (path === "/repo/apps/app/failing.ts") {
					throw new Error("File read error");
				}
				return super.readText(path);
			}
		}

		const fs = new FailingFileSystem({
			"/repo/apps/app/index.ts": 'import { Foo } from "foo";',
		});

		const walker = createWalker([
			{ path: "/repo/apps/app/index.ts" },
			{ path: "/repo/apps/app/failing.ts" },
		]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		expect(usage.warnings.length).toBeGreaterThan(0);
		expect(usage.warnings.some((w) => w.includes("Failed to read"))).toBe(true);
	});

	it("handles single-quoted strings", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      const str = 'single quoted string';
      import { Foo } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("handles escaped single quotes in strings", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": `
      const str = 'He said \\'hello\\'';
      import { Foo } from 'real-import';
    `,
		});
		const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
		const scanner = createImportScanner({ walker });

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		const record = usage.usage["@repo/app"];
		expect(record).toBeDefined();
		expect(record?.dependencies).toEqual(["real-import"]);
	});

	it("uses default walker when none provided", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/apps/app/index.ts": 'import { Foo } from "foo";',
		});

		const scanner = createImportScanner();

		const usage = await scanner.scan(
			baseInventory,
			baseConfig,
			{} as RepoManagerOptions,
			createMockLogger(),
			fs,
		);

		// The default walker would actually scan the filesystem,
		// but with our in-memory FS it won't find anything
		// This test just ensures the default walker is created without error
		expect(usage.usage).toBeDefined();
	});
});
