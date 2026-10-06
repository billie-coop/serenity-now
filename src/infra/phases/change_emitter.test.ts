import { describe, expect, it } from "vitest";
import {
	makeConfig,
	makeGraph,
	makeInventory,
	makeProject,
	ROOT,
} from "../../test_support/builders.js";
import { createCapturingLogger } from "../../test_support/logger.js";
import { createMemoryFs } from "../../test_support/memory_fs.js";
import { createChangeEmitter } from "./change_emitter.js";

const ui = makeProject("@acme/ui");
const web = makeProject("web", {
	relativeRoot: "apps/web",
	workspaceType: "app",
});
const inventory = makeInventory([web, ui]);

const WEB_PKG = `${ROOT}/apps/web/package.json`;
const WEB_TSCONFIG = `${ROOT}/apps/web/tsconfig.json`;
const UI_PKG = `${ROOT}/packages/ui/package.json`;
const UI_TSCONFIG = `${ROOT}/packages/ui/tsconfig.json`;

const SYNCED_WEB_TSCONFIG = `{
	"compilerOptions": {
		"paths": {
			"@acme/ui": ["../../packages/ui/src/index.ts"],
			"@acme/ui/*": ["../../packages/ui/src/*"]
		}
	},
	"references": [{ "path": "../../packages/ui" }]
}
`;

function files(overrides: Record<string, string> = {}) {
	return {
		[WEB_PKG]: '{\n  "name": "web"\n}\n',
		[WEB_TSCONFIG]: "{}\n",
		[UI_PKG]: '{\n\t"name": "@acme/ui"\n}\n',
		[UI_TSCONFIG]: "{}\n",
		...overrides,
	};
}

async function emit(
	fs: ReturnType<typeof createMemoryFs>,
	options: { dryRun?: boolean; scanned?: boolean } = {},
) {
	const graph = makeGraph(inventory, { web: ["@acme/ui"] });
	if (options.scanned === false) {
		(graph.projects.web as { scanned: boolean }).scanned = false;
	}
	const logger = createCapturingLogger();
	const result = await createChangeEmitter().emit(
		graph,
		inventory,
		makeConfig(),
		{ rootDir: ROOT, dryRun: options.dryRun },
		logger,
		fs,
	);
	return { result, logger };
}

describe("change emitter", () => {
	it("writes package.json and tsconfig.json, keeping comments and indentation", async () => {
		const fs = createMemoryFs(
			files({
				[WEB_PKG]: '{\n  "name": "web", // the app\n  "private": true\n}\n',
				[WEB_TSCONFIG]:
					'{\n\t// strict mode\n\t"compilerOptions": {\n\t\t"strict": true\n\t}\n}\n',
			}),
		);
		const { result, logger } = await emit(fs);

		expect(fs.files[WEB_PKG]).toBe(
			'{\n  "name": "web", // the app\n  "private": true,\n  "dependencies": {\n    "@acme/ui": "workspace:*"\n  }\n}\n',
		);
		const tsconfig = fs.files[WEB_TSCONFIG] as string;
		expect(tsconfig).toContain("\t// strict mode\n");
		expect(tsconfig).toContain('\t\t"strict": true,\n\t\t"paths": {');
		expect(tsconfig).toContain(
			'\t\t\t"@acme/ui": [\n\t\t\t\t"../../packages/ui/src/index.ts"',
		);
		expect(tsconfig).toContain('"path": "../../packages/ui"');

		expect(result.skippedProjects).toEqual([]);
		expect(result.fileChanges).toEqual([
			{
				projectId: "web",
				filePath: WEB_PKG,
				changes: [
					{
						action: "add",
						description: 'dependencies["@acme/ui"] = "workspace:*"',
					},
				],
			},
			{
				projectId: "web",
				filePath: WEB_TSCONFIG,
				changes: [
					{
						action: "add",
						description:
							'paths["@acme/ui"] = ["../../packages/ui/src/index.ts"]',
					},
					{
						action: "add",
						description: 'paths["@acme/ui/*"] = ["../../packages/ui/src/*"]',
					},
					{ action: "add", description: 'reference "../../packages/ui"' },
				],
			},
		]);
		expect(logger.messages.info).toEqual(["→ Updated 2 file(s)"]);
	});

	it("leaves files untouched on a dry run but still reports the changes", async () => {
		const original = files();
		const fs = createMemoryFs(original);
		const { result, logger } = await emit(fs, { dryRun: true });

		expect(fs.files).toEqual(original);
		expect(result.fileChanges.map((c) => c.filePath)).toEqual([
			WEB_PKG,
			WEB_TSCONFIG,
		]);
		expect(logger.messages.info).toEqual(["→ 2 file(s) need updating"]);
	});

	it("skips projects whose sources weren't scanned", async () => {
		const original = files();
		const fs = createMemoryFs(original);
		const { result } = await emit(fs, { scanned: false });

		expect(fs.files).toEqual(original);
		expect(result.fileChanges).toEqual([]);
		expect(result.skippedProjects).toEqual([
			{ projectId: "web", reason: "its sources were not scanned" },
		]);
	});

	it("reports nothing for projects already in sync", async () => {
		const original = files({
			[WEB_PKG]:
				'{\n\t"name": "web",\n\t"dependencies": { "@acme/ui": "workspace:*" }\n}\n',
			[WEB_TSCONFIG]: SYNCED_WEB_TSCONFIG,
		});
		const fs = createMemoryFs(original);
		const { result, logger } = await emit(fs);

		expect(fs.files).toEqual(original);
		expect(result.fileChanges).toEqual([]);
		expect(logger.messages.info).toEqual(["→ All files are in sync"]);
	});

	it("doesn't touch tsconfig.json for projects without one", async () => {
		const noTsconfig = makeProject("docs", {
			relativeRoot: "apps/docs",
			workspaceType: "app",
			tsconfigPath: undefined,
		});
		const inv = makeInventory([noTsconfig, ui]);
		const fs = createMemoryFs({
			[`${ROOT}/apps/docs/package.json`]: '{ "name": "docs" }',
			[UI_PKG]: '{ "name": "@acme/ui" }',
			[UI_TSCONFIG]: "{}",
		});
		const result = await createChangeEmitter().emit(
			makeGraph(inv, { docs: ["@acme/ui"] }),
			inv,
			makeConfig(),
			{ rootDir: ROOT },
			createCapturingLogger(),
			fs,
		);
		expect(result.fileChanges.map((c) => c.filePath)).toEqual([
			`${ROOT}/apps/docs/package.json`,
		]);
	});

	it("fails on a file that isn't a JSON object", async () => {
		const fs = createMemoryFs(files({ [WEB_PKG]: "[]" }));
		await expect(emit(fs)).rejects.toThrow(
			`${WEB_PKG} must contain a JSON object`,
		);
	});

	it("fails with the location of invalid JSON", async () => {
		const fs = createMemoryFs(files({ [WEB_TSCONFIG]: '{\n\t"a": }' }));
		await expect(emit(fs)).rejects.toThrow(`${WEB_TSCONFIG}:2:7: invalid JSON`);
	});
});
