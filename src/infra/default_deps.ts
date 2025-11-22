import type { RepoManagerDeps } from "../core/ports.ts";
import { createConsoleLogger } from "./logger/console_logger.ts";
import { denoFileSystem } from "./fs/deno_fs.ts";
import { createStubPhasePorts } from "./phases/stub_phases.ts";

interface DefaultDepsOptions {
  verbose?: boolean;
}

export function createDefaultDeps(
  options: DefaultDepsOptions = {},
): RepoManagerDeps {
  return {
    logger: createConsoleLogger(options.verbose ?? false),
    fileSystem: denoFileSystem,
    phases: createStubPhasePorts(),
  };
}
