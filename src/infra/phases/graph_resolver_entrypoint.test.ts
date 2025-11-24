import { describe, expect, it } from "vitest";
import type { FileSystemPort } from "../../core/ports.js";
import type { ProjectInfo } from "../../core/types.js";
import { defaultEntryPointResolver } from "./graph_resolver.js";

function createMockFs(existingFiles: Set<string>): FileSystemPort {
	return {
		fileExists: (path: string) => Promise.resolve(existingFiles.has(path)),
		readJson: <T>() => Promise.resolve({} as T),
		writeJson: () => Promise.resolve(),
		readText: () => Promise.resolve(""),
		writeText: () => Promise.resolve(),
	};
}

function createProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
	return {
		id: "@test/pkg",
		root: "/repo/packages/pkg",
		relativeRoot: "packages/pkg",
		packageJson: { name: "@test/pkg" },
		workspaceType: "shared-package",
		workspaceSubType: "library",
		isPrivate: false,
		...overrides,
	};
}

describe("entry point resolver", () => {
	it("prefers TypeScript source when it exists", async () => {
		const project = createProject();
		const fs = createMockFs(new Set(["/repo/packages/pkg/src/index.ts"]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("src/index.ts");
		expect(entryPoint.exists).toBe(true);
		expect(entryPoint.isTypeDefinition).toBe(false);
	});

	it("uses src/index.tsx if src/index.ts doesn't exist", async () => {
		const project = createProject();
		const fs = createMockFs(new Set(["/repo/packages/pkg/src/index.tsx"]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("src/index.tsx");
		expect(entryPoint.exists).toBe(true);
		expect(entryPoint.isTypeDefinition).toBe(false);
	});

	it("falls back to types field when no TS source", async () => {
		const project = createProject({
			packageJson: { name: "@test/pkg", types: "dist/index.d.ts" },
		});
		const fs = createMockFs(new Set(["/repo/packages/pkg/dist/index.d.ts"]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("dist/index.d.ts");
		expect(entryPoint.exists).toBe(true);
		expect(entryPoint.isTypeDefinition).toBe(true);
	});

	it("uses typings field if types not present", async () => {
		const project = createProject({
			packageJson: { name: "@test/pkg", typings: "lib/index.d.ts" },
		});
		const fs = createMockFs(new Set(["/repo/packages/pkg/lib/index.d.ts"]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("lib/index.d.ts");
		expect(entryPoint.exists).toBe(true);
		expect(entryPoint.isTypeDefinition).toBe(true);
	});

	it("uses exports field (string)", async () => {
		const project = createProject({
			packageJson: { name: "@test/pkg", exports: "./dist/index.js" },
		});
		const fs = createMockFs(new Set(["/repo/packages/pkg/dist/index.js"]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("./dist/index.js");
		expect(entryPoint.exists).toBe(true);
		expect(entryPoint.isTypeDefinition).toBe(false);
	});

	it("uses exports field (object with .)", async () => {
		const project = createProject({
			packageJson: {
				name: "@test/pkg",
				exports: { ".": "./dist/main.js" },
			},
		});
		const fs = createMockFs(new Set(["/repo/packages/pkg/dist/main.js"]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("./dist/main.js");
		expect(entryPoint.exists).toBe(true);
	});

	it("handles nested conditional exports", async () => {
		const project = createProject({
			packageJson: {
				name: "@test/pkg",
				exports: {
					".": {
						import: "./dist/index.js",
						require: "./dist/index.cjs",
						types: "./dist/index.d.ts",
					},
				},
			},
		});
		const fs = createMockFs(new Set(["/repo/packages/pkg/dist/index.js"]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("./dist/index.js");
		expect(entryPoint.exists).toBe(true);
		expect(entryPoint.isTypeDefinition).toBe(false);
	});

	it("uses main field when no other options", async () => {
		const project = createProject({
			packageJson: { name: "@test/pkg", main: "lib/index.js" },
		});
		const fs = createMockFs(new Set(["/repo/packages/pkg/lib/index.js"]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("lib/index.js");
		expect(entryPoint.exists).toBe(true);
	});

	it("prefers module over main", async () => {
		const project = createProject({
			packageJson: {
				name: "@test/pkg",
				main: "lib/index.js",
				module: "esm/index.js",
			},
		});
		const fs = createMockFs(
			new Set([
				"/repo/packages/pkg/lib/index.js",
				"/repo/packages/pkg/esm/index.js",
			]),
		);

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("esm/index.js");
		expect(entryPoint.exists).toBe(true);
	});

	it("returns fallback convention when nothing configured", async () => {
		const project = createProject();
		const fs = createMockFs(new Set([]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("src/index.ts");
		expect(entryPoint.exists).toBe(false);
	});

	it("marks configured entry as non-existent if file missing", async () => {
		const project = createProject({
			packageJson: { name: "@test/pkg", main: "dist/index.js" },
		});
		const fs = createMockFs(new Set([]));

		const entryPoint = await defaultEntryPointResolver(project, fs);

		expect(entryPoint.path).toBe("dist/index.js");
		expect(entryPoint.exists).toBe(false);
	});
});
