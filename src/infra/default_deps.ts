import type { RepoManagerDeps } from "../core/ports.js";
import { nodeFileSystem } from "./fs/node_fs.js";
import { createConsoleLogger } from "./logger/console_logger.js";
import { createChangeEmitter } from "./phases/change_emitter.js";
import { createConfigLoader } from "./phases/config_loader.js";
import { createSourceAnalyzer } from "./phases/source_analyzer.js";
import { createWorkspaceDiscovery } from "./phases/workspace_discovery.js";

export function createDefaultDeps(
	options: { verbose?: boolean } = {},
): RepoManagerDeps {
	return {
		logger: createConsoleLogger(options.verbose ?? false),
		fileSystem: nodeFileSystem,
		phases: {
			configLoader: createConfigLoader(),
			workspaceDiscovery: createWorkspaceDiscovery(),
			sourceAnalyzer: createSourceAnalyzer(),
			changeEmitter: createChangeEmitter(),
		},
	};
}
