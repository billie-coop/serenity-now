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
- Require it to exist for every workspace project
- Warn/error if missing

### Workspace Types

- Remove the `inferWorkspaceSubType()` guessing logic
- Remove the fallback guessing in `determineWorkspaceType()`
- Require explicit configuration in `workspaceTypes`
- If a project doesn't match any configured pattern, that's an error

### Code to Remove/Refactor

1. ✅ `inferWorkspaceSubType()` - REMOVED
2. ✅ `determineWorkspaceType()` fallback logic - REMOVED
3. ✅ `tsconfig.build.json` fallback - REMOVED
4. `resolveEntryPoint()` common patterns fallback in graph.ts - Remove guessing
5. Hardcoded `@billie-coop` references in `detectDiamondDependencies()` - Make
   config-driven
6. `DEFAULT_EXCLUDE_PATTERNS` in imports.ts - Should be configurable

## Testing Philosophy

- Tests should cover the explicit, configured behavior
- Don't test guessing/inference logic (because we shouldn't have it)
- Test error cases - missing configs should fail appropriately
