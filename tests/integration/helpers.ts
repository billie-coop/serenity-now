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
		compilerOptions: {},
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
