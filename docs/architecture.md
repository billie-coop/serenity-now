# Architecture

A short map of the code for contributors.

## Flow

`serenity-now` runs the same phases for every command (`src/core/repo_manager.ts`):

1. **Load config** (`infra/phases/config_loader.ts`): parse and validate `serenity-now.config.jsonc`, collecting every problem.
2. **Discover workspace** (`infra/phases/workspace_discovery.ts`): find workspace `package.json` files from the root `workspaces` globs and match each project to the first `workspaceTypes` pattern it fits.
3. **Analyze sources** (`infra/phases/source_analyzer.ts`): one TypeScript 7 session loads every project's tsconfig files (root, nested `tsconfig.json` files, and local references; nested ones are read-only) and reads imports, entry points and (when needed) exports.
4. **Resolve graph** (`core/graph.ts`): turn imports into workspace dependencies, then detect cycles and diamonds.
5. Then, depending on the command:
   - **sync**: `core/sync_plan.ts` plans the edits for each file and `infra/phases/change_emitter.ts` applies them with `jsonc-parser`, keeping comments and formatting.
   - **health**, **detect-unused-exports**, **generate-report**: format the graph and `core/unused_exports.ts` results (`interface/cli/output/`).

## Layout

- `src/core/`: domain types, ports, and pure logic (graph, sync plan, unused exports). No IO.
- `src/infra/`: adapters for ports.
  - `typescript/`: the TS 7 API (`typescript/unstable/sync`).
    - `session.ts` loads configs and decides which files each project owns.
    - `imports.ts` and `exports.ts` read the AST and checker.
    - `entry_point.ts` maps a package's declared entry point to its source.
  - `json/`: JSONC parsing and comment-preserving edits.
  - `glob/`: the single glob matcher (picomatch) every pattern option uses.
- `src/interface/cli/`: argument parsing (`node:util` `parseArgs`, built from `src/docs/content.ts`), help, the command runner and output formatters.
- `src/test_support/`: shared test helpers (in-memory filesystem, temp repos, capturing logger). Excluded from the build.
- `website/`: the docs site (Vite + React), a separate package so its dependencies never ship with serenity-now. The Docs view renders the root `README.md`, and the command cards come from `src/docs/content.ts`, so both stay in step with the CLI. The terminal demos in `website/src/demos.ts` are captured CLI output from `example/` and need updating when output formats change. Run it with `npm install && npm run dev` in `website/`; `.github/workflows/docs.yml` deploys it to GitHub Pages from `main`.

## TypeScript 7

TypeScript 7 is the native (Go) compiler. Its JavaScript API is `typescript/unstable/sync`, which talks to a `tsgo` process over a pipe. Two things to know:

- Each session spawns a process; `openTypeScriptSession` must always be followed by `close()`.
- `checker.getAliasedSymbol` crashes the server if called on a symbol that isn't an alias. Check `SymbolFlags.Alias` first.

The API is marked unstable, so `typescript` is pinned to an exact version.

## Safety rules

- A project whose sources weren't scanned (no tsconfig files, or none that include its own files) is never modified.
- tsconfig errors, config errors and workspace problems stop the run before anything is written.
- Sync only removes workspace packages from `dependencies`, and only removes `paths` and `references` that point at workspace packages.
