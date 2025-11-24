import type { RepoManagerDeps } from "../core/ports.js";
import { createConsoleLogger } from "./logger/console_logger.js";
import { nodeFileSystem } from "./fs/node_fs.js";
import { createConfigLoader } from "./phases/config_loader.js";
import { createWorkspaceDiscovery } from "./phases/workspace_discovery.js";
import { createImportScanner } from "./phases/import_scanner.js";
import { createGraphResolver } from "./phases/graph_resolver.js";
import { createChangeEmitter } from "./phases/change_emitter.js";

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
      importScanner: createImportScanner(),
      graphResolver: createGraphResolver(),
      changeEmitter: createChangeEmitter(),
    },
  };
}
