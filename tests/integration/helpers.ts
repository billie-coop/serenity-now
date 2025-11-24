import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function writeJsonFile(
	path: string,
	value: unknown,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextFile(
	path: string,
	value: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, value);
}

export interface TempRepo {
	root: string;
	appPackage?: string;
	appTsconfig?: string;
	teardown(): Promise<void>;
}

interface TempRepoOptions {
	includeStale?: boolean;
}

export async function createTempRepo(
	options: TempRepoOptions = {},
): Promise<TempRepo> {
	const includeStale = options.includeStale ?? true;
	const root = await mkdtemp(join(tmpdir(), "serenity-integration-"));

	await writeJsonFile(join(root, "package.json"), {
		name: "serenity-integration",
		private: true,
		workspaces: ["apps/*", "packages/*"],
	});

	await writeTextFile(
		join(root, "serenity-now.config.jsonc"),
		JSON.stringify(
			{
				workspaceTypes: {
					"apps/*": { type: "app", subType: "website" },
					"packages/*": { type: "shared-package" },
				},
			},
			null,
			2,
		),
	);

	const appDir = join(root, "apps/web");
	const appPackage = join(appDir, "package.json");
	const appTsconfig = join(appDir, "tsconfig.json");
	await writeJsonFile(appPackage, {
		name: "@repo/app-web",
		version: "0.0.0",
		dependencies: includeStale
			? {
					"@repo/unused": "workspace:*",
					lodash: "^4.17.0",
				}
			: {
					"@repo/lib": "workspace:*",
					lodash: "^4.17.0",
				},
	});
	await writeJsonFile(appTsconfig, {
		compilerOptions: {
			composite: true,
			baseUrl: ".",
			paths: includeStale
				? { "@repo/unused": ["../unused/src/index.ts"] }
				: {
						"@repo/lib": ["../../packages/lib/src/index.ts"],
						"@repo/lib/*": ["../../packages/lib/src/*"],
					},
		},
		references: includeStale
			? [{ path: "../unused" }]
			: [{ path: "../../packages/lib" }],
	});
	const staleImport = includeStale ? 'import "@repo/unused";\n' : "";
	await writeTextFile(
		join(appDir, "src/main.ts"),
		`${staleImport}import { greeting } from "@repo/lib";
console.log(greeting);`,
	);

	const libDir = join(root, "packages/lib");
	await writeJsonFile(join(libDir, "package.json"), {
		name: "@repo/lib",
		version: "0.0.0",
	});
	await writeJsonFile(join(libDir, "tsconfig.json"), {
		compilerOptions: {
			composite: true,
		},
	});
	await writeTextFile(
		join(libDir, "src/index.ts"),
		`export const greeting = "hello";`,
	);

	return {
		root,
		appPackage,
		appTsconfig,
		async teardown() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

export async function createCycleRepo(): Promise<TempRepo> {
	const root = await mkdtemp(join(tmpdir(), "serenity-cycle-"));

	await writeJsonFile(join(root, "package.json"), {
		name: "serenity-cycle",
		private: true,
		workspaces: ["packages/*"],
	});

	await writeTextFile(
		join(root, "serenity-now.config.jsonc"),
		JSON.stringify(
			{ workspaceTypes: { "packages/*": { type: "shared-package" } } },
			null,
			2,
		),
	);

	const pkgDir = (name: string) => join(root, "packages", name);

	await writeJsonFile(join(pkgDir("a"), "package.json"), {
		name: "@repo/a",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("a"), "tsconfig.json"), {
		compilerOptions: {},
	});
	await writeTextFile(
		join(pkgDir("a"), "src/index.ts"),
		`import { b } from "@repo/b";
export const a = "a" + b;`,
	);

	await writeJsonFile(join(pkgDir("b"), "package.json"), {
		name: "@repo/b",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("b"), "tsconfig.json"), {
		compilerOptions: {},
	});
	await writeTextFile(
		join(pkgDir("b"), "src/index.ts"),
		`import { a } from "@repo/a";
export const b = "b" + a;`,
	);

	return {
		root,
		async teardown() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

export async function createComplexRepo(): Promise<TempRepo> {
	const root = await mkdtemp(join(tmpdir(), "serenity-complex-"));

	await writeJsonFile(join(root, "package.json"), {
		name: "serenity-complex",
		private: true,
		workspaces: ["packages/*"],
	});

	await writeTextFile(
		join(root, "serenity-now.config.jsonc"),
		JSON.stringify(
			{
				workspaceTypes: { "packages/*": { type: "shared-package" } },
				defaultDependencies: ["@repo/utils"],
			},
			null,
			2,
		),
	);

	const pkgDir = (name: string) => join(root, "packages", name);

	// Utils package - will be a universal utility
	await writeJsonFile(join(pkgDir("utils"), "package.json"), {
		name: "@repo/utils",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("utils"), "tsconfig.json"), {
		compilerOptions: { composite: true },
	});
	await writeTextFile(
		join(pkgDir("utils"), "src/index.ts"),
		`export const util = "util";`,
	);

	// A package with many dependencies
	await writeJsonFile(join(pkgDir("a"), "package.json"), {
		name: "@repo/a",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("a"), "tsconfig.json"), {
		compilerOptions: { composite: true },
	});
	await writeTextFile(
		join(pkgDir("a"), "src/index.ts"),
		`import { b } from "@repo/b";
import { c } from "@repo/c";
import { util } from "@repo/utils";
export const a = b + c + util;`,
	);

	// B package
	await writeJsonFile(join(pkgDir("b"), "package.json"), {
		name: "@repo/b",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("b"), "tsconfig.json"), {
		compilerOptions: { composite: true },
	});
	await writeTextFile(
		join(pkgDir("b"), "src/index.ts"),
		`import { util } from "@repo/utils";
export const b = "b" + util;`,
	);

	// C package
	await writeJsonFile(join(pkgDir("c"), "package.json"), {
		name: "@repo/c",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("c"), "tsconfig.json"), {
		compilerOptions: { composite: true },
	});
	await writeTextFile(
		join(pkgDir("c"), "src/index.ts"),
		`import { util } from "@repo/utils";
export const c = "c" + util;`,
	);

	// Package with missing tsconfig
	await writeJsonFile(join(pkgDir("broken"), "package.json"), {
		name: "@repo/broken",
		version: "0.0.0",
	});
	// Intentionally no tsconfig.json

	return {
		root,
		async teardown() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

export async function createRepoWithUnusedPackages(): Promise<TempRepo> {
	const root = await mkdtemp(join(tmpdir(), "serenity-unused-"));

	await writeJsonFile(join(root, "package.json"), {
		name: "serenity-unused",
		private: true,
		workspaces: ["packages/*", "apps/*"],
	});

	await writeTextFile(
		join(root, "serenity-now.config.jsonc"),
		JSON.stringify(
			{
				workspaceTypes: {
					"packages/*": { type: "shared-package" },
					"apps/*": { type: "app" },
				},
			},
			null,
			2,
		),
	);

	const pkgDir = (name: string) => join(root, "packages", name);
	const appDir = (name: string) => join(root, "apps", name);

	// Used shared package
	await writeJsonFile(join(pkgDir("utils"), "package.json"), {
		name: "@repo/utils",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("utils"), "tsconfig.json"), {
		compilerOptions: { composite: true },
	});
	await writeTextFile(
		join(pkgDir("utils"), "src/index.ts"),
		`export const util = "util";`,
	);

	// Unused shared package - nobody imports it, and it has no TypeScript files
	await writeJsonFile(join(pkgDir("unused"), "package.json"), {
		name: "@repo/unused",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("unused"), "tsconfig.json"), {
		compilerOptions: { composite: true },
		files: [],
	});

	// App that uses utils
	await writeJsonFile(join(appDir("web"), "package.json"), {
		name: "@repo/web",
		version: "0.0.0",
	});
	await writeJsonFile(join(appDir("web"), "tsconfig.json"), {
		compilerOptions: { composite: true },
	});
	await writeTextFile(
		join(appDir("web"), "src/index.ts"),
		`import { util } from "@repo/utils";
console.log(util);`,
	);

	return {
		root,
		async teardown() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

export async function createRepoWithManyDiamonds(): Promise<TempRepo> {
	const root = await mkdtemp(join(tmpdir(), "serenity-diamonds-"));

	await writeJsonFile(join(root, "package.json"), {
		name: "serenity-diamonds",
		private: true,
		workspaces: ["packages/*"],
	});

	await writeTextFile(
		join(root, "serenity-now.config.jsonc"),
		JSON.stringify(
			{ workspaceTypes: { "packages/*": { type: "shared-package" } } },
			null,
			2,
		),
	);

	const pkgDir = (name: string) => join(root, "packages", name);

	// Create 15 base packages
	for (let i = 1; i <= 15; i++) {
		await writeJsonFile(join(pkgDir(`base${i}`), "package.json"), {
			name: `@repo/base${i}`,
			version: "0.0.0",
		});
		await writeJsonFile(join(pkgDir(`base${i}`), "tsconfig.json"), {
			compilerOptions: { composite: true },
		});
		await writeTextFile(
			join(pkgDir(`base${i}`), "src/index.ts"),
			`export const base${i} = "base${i}";`,
		);
	}

	// Create 15 intermediate packages, each depending on one base package
	for (let i = 1; i <= 15; i++) {
		await writeJsonFile(join(pkgDir(`mid${i}`), "package.json"), {
			name: `@repo/mid${i}`,
			version: "0.0.0",
		});
		await writeJsonFile(join(pkgDir(`mid${i}`), "tsconfig.json"), {
			compilerOptions: { composite: true },
		});
		await writeTextFile(
			join(pkgDir(`mid${i}`), "src/index.ts"),
			`import { base${i} } from "@repo/base${i}";
export const mid${i} = base${i} + "mid";`,
		);
	}

	// Create a top package that depends on all bases directly AND all mids
	// This creates 15 diamond dependencies (one for each base package):
	// top → base{i} (direct) AND top → mid{i} → base{i} (transitive)
	await writeJsonFile(join(pkgDir("top"), "package.json"), {
		name: "@repo/top",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("top"), "tsconfig.json"), {
		compilerOptions: { composite: true },
	});

	const baseImports = Array.from(
		{ length: 15 },
		(_, i) => `import { base${i + 1} } from "@repo/base${i + 1}";`,
	).join("\n");
	const midImports = Array.from(
		{ length: 15 },
		(_, i) => `import { mid${i + 1} } from "@repo/mid${i + 1}";`,
	).join("\n");

	await writeTextFile(
		join(pkgDir("top"), "src/index.ts"),
		`${baseImports}
${midImports}
export const top = "all";`,
	);

	return {
		root,
		async teardown() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

export async function createRepoWithManyDiamondOccurrences(): Promise<TempRepo> {
	const root = await mkdtemp(join(tmpdir(), "serenity-diamond-occ-"));

	await writeJsonFile(join(root, "package.json"), {
		name: "serenity-diamond-occ",
		private: true,
		workspaces: ["packages/*"],
	});

	await writeTextFile(
		join(root, "serenity-now.config.jsonc"),
		JSON.stringify(
			{ workspaceTypes: { "packages/*": { type: "shared-package" } } },
			null,
			2,
		),
	);

	const pkgDir = (name: string) => join(root, "packages", name);

	// Create a shared base package
	await writeJsonFile(join(pkgDir("base"), "package.json"), {
		name: "@repo/base",
		version: "0.0.0",
	});
	await writeJsonFile(join(pkgDir("base"), "tsconfig.json"), {
		compilerOptions: { composite: true },
	});
	await writeTextFile(
		join(pkgDir("base"), "src/index.ts"),
		`export const base = "base";`,
	);

	// Create 5 intermediate packages that depend on base
	for (let i = 1; i <= 5; i++) {
		await writeJsonFile(join(pkgDir(`mid${i}`), "package.json"), {
			name: `@repo/mid${i}`,
			version: "0.0.0",
		});
		await writeJsonFile(join(pkgDir(`mid${i}`), "tsconfig.json"), {
			compilerOptions: { composite: true },
		});
		await writeTextFile(
			join(pkgDir(`mid${i}`), "src/index.ts"),
			`import { base } from "@repo/base";
export const mid${i} = base + "${i}";`,
		);
	}

	// Create 5 consumer packages, each depends on base directly AND one mid package
	// This creates 5 diamond occurrences for base (one in each consumer)
	for (let i = 1; i <= 5; i++) {
		await writeJsonFile(join(pkgDir(`consumer${i}`), "package.json"), {
			name: `@repo/consumer${i}`,
			version: "0.0.0",
		});
		await writeJsonFile(join(pkgDir(`consumer${i}`), "tsconfig.json"), {
			compilerOptions: { composite: true },
		});
		await writeTextFile(
			join(pkgDir(`consumer${i}`), "src/index.ts"),
			`import { base } from "@repo/base";
import { mid${i} } from "@repo/mid${i}";
export const consumer${i} = base + mid${i};`,
		);
	}

	return {
		root,
		async teardown() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

export function captureConsole() {
	const originalLog = console.log;
	const originalError = console.error;
	const logs: string[] = [];
	const errors: string[] = [];
	console.log = ((...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	}) as typeof console.log;
	console.error = ((...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	}) as typeof console.error;
	return {
		logs,
		errors,
		restore() {
			console.log = originalLog;
			console.error = originalError;
		},
	};
}
