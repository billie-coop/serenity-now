import type { RepoManagerDeps } from "../core/ports.js";
import { nodeFileSystem } from "./fs/node_fs.js";
import { createConsoleLogger } from "./logger/console_logger.js";
import { createChangeEmitter } from "./phases/change_emitter.js";
import { createConfigLoader } from "./phases/config_loader.js";
import { createGraphResolver } from "./phases/graph_resolver.js";
import { createTypeScriptExportScanner } from "./phases/typescript_export_scanner.js";
import { createTypeScriptImportScanner } from "./phases/typescript_import_scanner.js";
import { createUnusedExportDetector } from "./phases/unused_export_detector.js";
import { createWorkspaceDiscovery } from "./phases/workspace_discovery.js";

interface DefaultDepsOptions {
	verbose?: boolean;
}

export function createDefaultDeps(
	options: DefaultDepsOptions = {},
): RepoManagerDeps {
	return {
		logger: createConsoleLogger(options.verbose ?? false),
		fileSystem: nodeFileSystem,
		phases: {
			configLoader: createConfigLoader(),
			workspaceDiscovery: createWorkspaceDiscovery(),
			importScanner: createTypeScriptImportScanner(),
			graphResolver: createGraphResolver(),
			changeEmitter: createChangeEmitter(),
			exportScanner: createTypeScriptExportScanner(),
			unusedExportDetector: createUnusedExportDetector(),
		},
	};
}
