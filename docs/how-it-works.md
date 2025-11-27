# How It Works

Serenity Now keeps three things in sync so TypeScript's incremental compilation works correctly in your monorepo.

## The Core Problem

In a TypeScript monorepo, you need to keep these three things aligned:

1. **Your actual imports** - The code you write
2. **package.json dependencies** - What npm/yarn/pnpm knows about
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

It analyzes your source code to find all imports from other workspace packages:

```typescript
import { helper } from "@myorg/utils";
import type { User } from "@myorg/types";
```

### 2. Updates package.json

Adds workspace dependencies for packages you actually import:

```json
{
  "dependencies": {
    "@myorg/utils": "workspace:*"
  },
  "devDependencies": {
    "@myorg/types": "workspace:*"
  }
}
```

It also removes dependencies that are no longer imported.

### 3. Updates tsconfig.json References

Adds TypeScript project references so incremental compilation works:

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
- **Missing configurations** - Projects without `tsconfig.json` or `package.json`
- **Naming violations** - Packages that don't match your configured naming pattern

## Understanding Diamond Dependencies

A diamond dependency happens when multiple packages depend on the same shared package:

```
    app-web
      |
      v
   shared-utils  <-- Diamond!
      ^
      |
    app-api
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
app-web --> database-utils
app-api --> database-utils
worker  --> database-utils
```

This might suggest you need a `data-access` layer that wraps `database-utils`, so apps don't directly depend on database implementation details.

**Use `universalUtilities` wisely:**

Mark packages as universal utilities when it's genuinely expected:

```jsonc
{
  "universalUtilities": ["logger", "types", "config"],
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
- [pnpm Workspaces](https://pnpm.io/workspaces)
