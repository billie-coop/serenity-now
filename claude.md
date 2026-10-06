# Claude Context for Serenity Now

## Project Philosophy

**Keep it simple. Don't be clever. Be strict but reasonable.**

This is a monorepo tool focused on:

- Ensuring incremental TypeScript compilation works correctly
- Keeping internal workspace dependencies in sync
- Enforcing reasonable, explicit standards

## Design Principles

### 1. No Guessing

- Don't infer or guess configuration
- Don't have fallback logic that tries to be "smart"
- If something is wrong, warn or error - don't silently adapt

### 2. Explicit Configuration

- Users should explicitly configure workspace types
- No "clever" pattern matching or inference
- Configuration should be clear and predictable

### 3. Strict but Reasonable Rules

- **Reasonable:** Every project must have `tsconfig.json` (required for
  incremental compilation)
- **Reasonable:** Package names should follow configured patterns
- **Not reasonable:** Guessing workspace types based on directory names
- **Not reasonable:** Falling back to alternative config file names

### 4. Fail Fast

- If a project is misconfigured, report it
- Don't try to work around missing configuration
- Clear errors are better than silent workarounds

## Specific Decisions

### TypeScript Configuration

- Only look for `tsconfig.json` (not `tsconfig.build.json` or other variants)
  as a project's config (the one sync writes). Also scanned, read-only: any
  `tsconfig.json` in a subdirectory (e.g. standalone `convex/tsconfig.json`)
  and tsconfig files referenced inside the project (e.g. Vite's
  `tsconfig.app.json`). Nested configs are never written, so they don't need
  `composite`.
- Require it to exist for every workspace project unless the workspace type
  sets `requiresTsconfig: false`
- tsconfig errors (including options TypeScript 7 removed) stop the run

### TypeScript 7

- serenity-now targets TypeScript 7 only (the native compiler), both for its
  own build (`tsc`) and for analyzing user code (`typescript/unstable/sync`)
- `typescript` is pinned to an exact version because the API is unstable
- See `docs/architecture.md` for API gotchas

### Workspace Types

- Require explicit configuration in `workspaceTypes`
- Every project must match a pattern; matching none is an error. The first
  match in config order wins (explicit ordering, not inference), so specific
  keys go before catch-alls

### Entry Points

- A package's entry point is what package.json declares (`exports` ".",
  then `types`, then `main`/`module`). No `src/index.ts` convention fallback.
- Build output inside a tsconfig `outDir` maps back to `rootDir`; that's
  explicit config, not a guess

### Safety

- Never modify a project whose sources weren't scanned
- Sync only removes workspace packages from `dependencies` (never
  `devDependencies`/`peerDependencies`), and only workspace `paths`/`references`
- Edit JSON with `jsonc-parser` so comments and formatting survive

### Code Organization

- No duplicate implementations: one glob matcher (`infra/glob`), one JSONC
  parser (`infra/json`), one entry point resolver, one TypeScript session
- Keep files small and focused; pure logic lives in `src/core/`

## Testing Philosophy

- Tests should cover the explicit, configured behavior
- Don't test guessing/inference logic (because we shouldn't have it)
- Test error cases - missing configs should fail appropriately
- Anything touching the TypeScript API uses real temp repos
  (`src/test_support/temp_repo.ts`); pure logic uses in-memory data
