import type { RepoManagerDeps } from "../core/ports.ts";
import { createConsoleLogger } from "./logger/console_logger.ts";
import { denoFileSystem } from "./fs/deno_fs.ts";
import { createStubPhasePorts } from "./phases/stub_phases.ts";
import { createConfigLoader } from "./phases/config_loader.ts";
import { createWorkspaceDiscovery } from "./phases/workspace_discovery.ts";

interface DefaultDepsOptions {
  verbose?: boolean;
}

export function createDefaultDeps(
  options: DefaultDepsOptions = {},
): RepoManagerDeps {
  const stubPhases = createStubPhasePorts();
  return {
    logger: createConsoleLogger(options.verbose ?? false),
    fileSystem: denoFileSystem,
    phases: {
      ...stubPhases,
      configLoader: createConfigLoader(),
      workspaceDiscovery: createWorkspaceDiscovery(),
    },
  };
}
