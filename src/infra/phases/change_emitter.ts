import { join } from "node:path";
import { ConfigurationError } from "../../core/errors.js";
import { isJsonObject } from "../../core/json.js";
import type {
	ChangeEmitterPort,
	FileSystemPort,
	LoggerPort,
} from "../../core/ports.js";
import {
	type FilePlan,
	planPackageJson,
	planTsconfig,
} from "../../core/sync_plan.js";
import type {
	EmitResult,
	FileChange,
	JsonObject,
	ProjectInventory,
	RepoManagerOptions,
	ResolvedGraph,
	SyncConfig,
} from "../../core/types.js";
import { applyJsonEdits, parseJsonc } from "../json/jsonc.js";

export function createChangeEmitter(): ChangeEmitterPort {
	return {
		async emit(
			graph: ResolvedGraph,
			inventory: ProjectInventory,
			config: SyncConfig,
			options: RepoManagerOptions,
			logger: LoggerPort,
			fs: FileSystemPort,
		): Promise<EmitResult> {
			const result: EmitResult = { fileChanges: [], skippedProjects: [] };

			for (const [projectId, resolved] of Object.entries(graph.projects)) {
				if (!resolved.scanned) {
					result.skippedProjects.push({
						projectId,
						reason: "its sources were not scanned",
					});
					continue;
				}

				const packageJsonPath = join(resolved.project.root, "package.json");
				const change = await syncFile(
					fs,
					packageJsonPath,
					(doc) => planPackageJson(resolved, doc, inventory, config),
					options.dryRun ?? false,
				);
				if (change) result.fileChanges.push({ projectId, ...change });

				const tsconfigPath = resolved.project.tsconfigPath;
				if (tsconfigPath) {
					const tsChange = await syncFile(
						fs,
						tsconfigPath,
						(doc) => planTsconfig(resolved, doc, tsconfigPath, inventory),
						options.dryRun ?? false,
					);
					if (tsChange) result.fileChanges.push({ projectId, ...tsChange });
				}
			}

			const count = result.fileChanges.length;
			logger.info(
				count === 0
					? "→ All files are in sync"
					: options.dryRun
						? `→ ${count} file(s) need updating`
						: `→ Updated ${count} file(s)`,
			);
			return result;
		},
	};
}

/** Plans and (unless dryRun) writes one file. Returns undefined if it's already in sync. */
async function syncFile(
	fs: FileSystemPort,
	filePath: string,
	plan: (doc: JsonObject) => FilePlan,
	dryRun: boolean,
): Promise<Omit<FileChange, "projectId"> | undefined> {
	const text = await fs.readText(filePath);
	const doc = parseJsonc(text, filePath);
	if (!isJsonObject(doc)) {
		throw new ConfigurationError(`${filePath} must contain a JSON object`);
	}

	const { edits, changes } = plan(doc);
	if (edits.length === 0) return undefined;

	if (!dryRun) {
		await fs.writeText(filePath, applyJsonEdits(text, edits));
	}
	return { filePath, changes };
}
