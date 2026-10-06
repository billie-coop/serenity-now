import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** File contents: strings are written as-is, anything else as formatted JSON. */
export type RepoFiles = Record<string, string | object>;

export interface TempRepo {
	root: string;
	path(relativePath: string): string;
	read(relativePath: string): string;
	readJson<T = Record<string, unknown>>(relativePath: string): T;
	write(files: RepoFiles): void;
	cleanup(): void;
}

/** Creates a real directory tree under the OS temp dir (the TypeScript API reads from disk). */
export function createTempRepo(files: RepoFiles): TempRepo {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "serenity-now-test-")));
	const repo: TempRepo = {
		root,
		path: (p) => join(root, p),
		read: (p) => readFileSync(join(root, p), "utf-8"),
		readJson: (p) => JSON.parse(readFileSync(join(root, p), "utf-8")),
		write(more) {
			for (const [p, contents] of Object.entries(more)) {
				const full = join(root, p);
				mkdirSync(dirname(full), { recursive: true });
				writeFileSync(
					full,
					typeof contents === "string"
						? contents
						: `${JSON.stringify(contents, null, "\t")}\n`,
				);
			}
		},
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
	repo.write(files);
	return repo;
}

/**
 * A minimal monorepo: root package.json with apps/* and packages/* workspaces
 * and a config mapping them to app and shared-package. Merge in more files.
 */
export function monorepo(files: RepoFiles, config: object = {}): RepoFiles {
	return {
		"package.json": {
			name: "root",
			private: true,
			workspaces: ["apps/*", "packages/*"],
		},
		"serenity-now.config.jsonc": {
			workspaceTypes: {
				"apps/*": { type: "app" },
				"packages/*": { type: "shared-package" },
			},
			...config,
		},
		...files,
	};
}

/** package.json + composite tsconfig.json + src/index.ts for a shared package with a source entry point. */
export function sharedPackage(
	dir: string,
	name: string,
	source: string,
	packageJson: object = {},
): RepoFiles {
	return {
		[`${dir}/package.json`]: {
			name,
			exports: "./src/index.ts",
			...packageJson,
		},
		[`${dir}/tsconfig.json`]: {
			compilerOptions: { composite: true },
			include: ["src"],
		},
		[`${dir}/src/index.ts`]: source,
	};
}
