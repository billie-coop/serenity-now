# Serenity Now – Hexagonal Rewrite Plan

## 1. Clean Slate
1. Delete `src/`, `cli.ts`, and any other runtime code (keep `tests/` temporarily for fixture reference).
2. Keep `README.md`, `tests/`, `example/`, and tooling configs (`deno.json`, `deno.lock`) so the repo still has docs and scripts.

## 2. Core (Hexagon)
1. Create `src/core/types.ts` with all domain models (repo options, inventory, usage, graph, emit result, etc.).
2. Create `src/core/ports.ts` defining:
   - `LoggerPort`, `FileSystemPort`.
   - One port per use-case (`ConfigLoaderPort`, `WorkspaceDiscoveryPort`, `ImportScannerPort`, `GraphResolverPort`, `ChangeEmitterPort`), or a `PhasePorts` aggregate.
3. Implement `src/core/repo_manager.ts` as the orchestrator:
   - Accepts `RepoManagerOptions` + `RepoManagerDeps`.
   - Methods: `loadConfig`, `discoverWorkspace`, `scanImports`, `resolveGraph`, `emitChanges`.
   - No imports from infra; only talks to ports.
4. Add `src/core/repo_manager.test.ts` with pure unit tests using in-memory fakes for every port.

## 3. Use-Case Services (Optional but recommended)
1. Under `src/usecases/`, create modules (`load_config.ts`, `discover_workspace.ts`, etc.) that implement the domain logic of each phase and depend only on core types/ports.
2. Each module exports a function/class that the orchestrator (or adapters) can call, keeping logic close to the domain.

## 4. Infrastructure Adapters
1. `src/infra/logger/console_logger.ts` – wraps the existing `Logger` implementation to satisfy `LoggerPort`.
2. `src/infra/fs/deno_fs.ts` – wraps Deno’s fs helpers for `FileSystemPort`.
3. `src/infra/phases/` – adapters that plug current behavior into the new ports:
   - `config_loader_adapter.ts` (reads files, parses JSONC, validates).
   - `workspace_discovery_adapter.ts` (glob + package parsing).
   - `import_scanner_adapter.ts`, `graph_resolver_adapter.ts`, `change_emitter_adapter.ts`.
4. Each adapter maps from `RepoManager` options/config to the old phase functions until we refactor those functions into pure use-cases.

## 5. Composition Root
1. Create `src/interface/cli/run.ts` (or keep `cli.ts`) as the only file that:
   - Parses CLI flags.
   - Instantiates adapters (`makeLogger`, `fsAdapter`, phase adapters).
   - Builds `RepoManager` and executes phases in order.
   - Handles process exit codes and warning output.
2. Top-level `cli.ts` simply imports and runs this composition root.

## 6. Testing & CI
1. Update `tests/` to cover:
   - Core unit tests (fakes only).
   - Adapter tests (touch Deno APIs or fixtures as needed).
   - End-to-end CLI tests using existing fixtures to ensure behavior parity.
2. Keep `tests/integration/` structure but re-point to the new CLI entrypoint.

## 7. Documentation
1. Document the architecture in `README.md` or a new `docs/ARCHITECTURE.md` (layers, ports, adapters, composition root).
2. Update any contributor docs (`TESTING.md`, etc.) to reflect the new layout and testing strategy.

## 8. Follow-up Refinements
1. Gradually move logic from adapters into `usecases/` so adapters become thin shells.
2. Consider additional adapters (e.g., JSON output logger, file-less dry-run, etc.) once DI is in place.
