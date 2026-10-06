# How It Works

Serenity Now keeps three things in sync so TypeScript's incremental compilation works correctly in your monorepo.

## The Core Problem

In a TypeScript monorepo, you need to keep these three things aligned:

1. **Your actual imports** - The code you write
2. **package.json dependencies** - What your package manager knows about
3. **tsconfig.json references** - What TypeScript knows about

When these drift apart, TypeScript can't properly type-check or incrementally compile your code.

## TypeScript Project References

TypeScript has a feature called [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) that allows you to structure your TypeScript codebase into smaller pieces.

**The Short Version:**

- Each package in your monorepo is a separate TypeScript "project"
- Projects can reference other projects they depend on
- TypeScript uses these references to:
  - Build projects in the correct order
  - Only rebuild what actually changed (incremental compilation)
  - Provide fast, accurate type checking across your entire monorepo

**Example `tsconfig.json` with project references:**

```jsonc
{
  "compilerOptions": {
    "composite": true, // Required for project references
    // ... other options
  },
  "references": [{ "path": "../utils" }, { "path": "../types" }],
}
```

The `composite: true` setting enables incremental compilation and makes the project referenceable by others.

**Learn more:** [TypeScript Project References Documentation](https://www.typescriptlang.org/docs/handbook/project-references.html)

## What Serenity Now Does

Serenity Now automates the tedious work of keeping everything in sync:

### 1. Scans Your Imports

It loads each project's tsconfig files with the TypeScript 7 compiler: the root `tsconfig.json`, any `tsconfig.json` in a subdirectory (like a standalone `convex/tsconfig.json`), and tsconfig files those reference inside the project (like Vite's `tsconfig.app.json`). Nested tsconfig files only add sources to scan; serenity-now never writes to them, so they don't need `composite`. Then it reads every file those configs include to find imports of other workspace packages:

```typescript
import { helper } from "@myorg/utils";
import type { User } from "@myorg/types";
export { Button } from "@myorg/ui";
const charts = await import("@myorg/charts");
```

Static imports, `export ... from`, `import x = require()`, dynamic `import()`, `require()` and `typeof import()` all count. Files are scanned wherever they live (`src/`, `app/`, `pages/`), as long as the tsconfig includes them.

If a project's sources can't be scanned (no tsconfig files, or tsconfig files that include none of its own files), that project is reported and **never modified**. A tsconfig with errors stops the run.

### 2. Updates package.json

Adds workspace dependencies for packages you actually import, using the configured `workspaceDependencyVersion`:

```json
{
  "dependencies": {
    "@myorg/utils": "workspace:*",
    "@myorg/types": "workspace:*"
  }
}
```

It also removes workspace packages from `dependencies` when nothing imports them anymore. Workspace packages you've put in `devDependencies` or `peerDependencies` stay there and are never removed, since tooling may use them in ways an import scan can't see.

### 3. Updates tsconfig.json Paths and References

Adds `compilerOptions.paths` pointing at each imported package's source entry point, plus TypeScript project references so incremental compilation works:

```jsonc
{
  "compilerOptions": {
    "composite": true,
  },
  "references": [{ "path": "../utils" }, { "path": "../types" }],
}
```

### 4. Validates Architecture

Checks for common issues:

- **Circular dependencies** - Package A depends on B, B depends on A (breaks TypeScript incremental compilation)
- **Diamond dependencies** - Multiple packages depend on the same shared package
- **Missing configurations** - Projects without `tsconfig.json`, without a `name`, or not matching any workspace type
- **Naming violations** - Packages that don't start with their workspace type's `enforceNamePrefix`

Run `serenity-now health` for the full report.

## Understanding Diamond Dependencies

A diamond dependency happens when a project imports a package directly *and* also depends on it through another dependency:

```
        app-web
       /       \
      v         v
  ui-kit ---> shared-utils   <-- app-web reaches shared-utils twice
```

**When they're fine:**

- Shared utilities like logging, config, or common types
- Well-abstracted packages with clear responsibilities
- Listed in `universalUtilities` config

**When they might indicate a problem:**

Diamond dependencies can sometimes point to incomplete abstractions or architectural issues:

- **Missing abstraction layer** - Maybe you need an intermediate package that depends on the shared utility, and your apps depend on that instead
- **Leaked implementation details** - If many packages depend on the same low-level utility, those details might be too exposed
- **Package doing too much** - A shared package with many dependents might have mixed responsibilities that should be split

**Example of a problematic pattern:**

```
app-web --> data-access --> database-utils
app-web ------------------> database-utils
```

`app-web` goes around `data-access` to reach `database-utils` directly. Maybe `data-access` is missing something `app-web` needs.

**Use `universalUtilities` wisely:**

Mark packages as universal utilities when it's genuinely expected:

```jsonc
{
  "universalUtilities": ["@myorg/logger", "@myorg/types"],
}
```

But if you find yourself adding many packages here, it might be worth reconsidering your architecture.

## Why This Matters

### Without Serenity Now:

```bash
# Add an import
import { foo } from '@myorg/utils';

# TypeScript doesn't know about it yet
tsc --build  # ❌ Error: Cannot find module '@myorg/utils'

# Manually add to package.json
npm install @myorg/utils

# Still doesn't work for type checking across packages
tsc --build  # ⚠️ No incremental compilation, slow builds

# Manually add to tsconfig.json references
# Edit tsconfig.json...

# Finally works
tsc --build  # ✅ But you had to do 3 manual steps
```

### With Serenity Now:

```bash
# Add an import
import { foo } from '@myorg/utils';

# Run serenity-now
npm run sync

# Everything is updated automatically
tsc --build  # ✅ Works perfectly, incremental compilation enabled
```

## Benefits of Proper Setup

Once your project references are correct:

- **Fast incremental builds** - TypeScript only rebuilds what changed
- **Accurate type checking** - TypeScript understands your entire dependency graph
- **Better IDE experience** - Go-to-definition works across packages
- **Enforced build order** - TypeScript builds dependencies before dependents
- **Easier refactoring** - Move code between packages with confidence

## The "No Guessing" Philosophy

Serenity Now follows a strict principle: **don't guess, don't infer, don't be clever.**

- It doesn't try to infer workspace types from directory names
- It doesn't fall back to alternative config file names
- If something is wrong, it tells you clearly

This makes the tool predictable and prevents subtle bugs from silent assumptions.

## Learn More

- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [TypeScript Composite Projects](https://www.typescriptlang.org/tsconfig#composite)
- [npm Workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces)
- [yarn Workspaces](https://yarnpkg.com/features/workspaces)
