# Getting Started

A quick guide to get Serenity Now running in your TypeScript monorepo.

## Prerequisites

- Node.js >= 22.12
- A TypeScript monorepo with workspaces declared in the root `package.json` (npm, yarn or bun)
- Every workspace project must have:
  - `package.json` with a `name` field
  - `tsconfig.json` (unless its workspace type sets `"requiresTsconfig": false`)
- tsconfig files that are valid for TypeScript 7 (serenity-now analyzes your code with it)

## Installation

Install as a dev dependency in your monorepo root:

```bash
npm install --save-dev serenity-now
```

## Initial Setup

### 1. First Run - Generate Config

On your first run, Serenity Now will generate a default configuration file if one doesn't exist:

```bash
npx serenity-now
```

This creates `serenity-now.config.jsonc` with basic workspace type patterns. You'll need to edit this file to match your monorepo's structure.

### 2. Configure Workspace Types

Edit `serenity-now.config.jsonc` to match your directory structure:

```jsonc
{
  "workspaceTypes": {
    "apps/*": { "type": "app" },
    "packages/*": { "type": "shared-package" },
  },
}
```

The `workspaceTypes` configuration is **required**. Keys are glob patterns for project directories, and every workspace project must match one of them (the first matching pattern wins). Using npm? Also set `"workspaceDependencyVersion": "*"`, because npm doesn't support `workspace:*`.

Packages that other projects import must declare an entry point in `package.json` (`exports`, `types` or `main`). Serenity Now maps it to the source file for `paths`; build output inside the package's tsconfig `outDir` is mapped back to its `rootDir`.

### 3. Run and Verify

After configuring your workspace types, run Serenity Now to sync your dependencies:

```bash
npx serenity-now --dry-run   # see what would change
npx serenity-now             # apply it
```

This will:

- Scan every file each project's tsconfig includes for imports of other workspace packages
- Add missing workspace dependencies to `package.json` and remove ones nothing imports
- Update `compilerOptions.paths` and `references` in each project's `tsconfig.json`

Comments, formatting and anything that isn't a workspace dependency are left untouched.

### 4. Set Up TypeScript Configuration (Recommended)

For best results with TypeScript project references, use a two-file setup:

**Root `tsconfig.json`** - Just for project references (you list your projects here; Serenity Now manages references between projects, not this file):

```jsonc
{
  "files": [],
  "references": [{ "path": "./apps/web" }, { "path": "./packages/utils" }],
}
```

**Root `tsconfig.options.json`** - Your actual compiler options:

```jsonc
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "strict": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    // ... all your other compiler options
  },
}
```

Then in your workspace `tsconfig.json` files:

```jsonc
{
  "extends": "../../tsconfig.options.json",
  "compilerOptions": {
    "outDir": "./dist",
  },
  "include": ["src/**/*"],
  "references": [
    // Serenity Now manages these too
  ],
}
```

**Why this pattern?** It separates concerns: `tsconfig.json` handles project structure (managed by Serenity Now), while `tsconfig.options.json` handles your compiler settings (managed by you).

### 5. Add to Package Scripts

Add convenience scripts to your root `package.json`:

```json
{
  "scripts": {
    "sync": "serenity-now",
    "sync:check": "serenity-now --check"
  }
}
```

Now you can run:

- `npm run sync` - Fix dependencies automatically
- `npm run sync:check` - Check if anything is out of sync (useful for CI)

## Common Workflows

### During Development

As you work and add imports to other workspace packages, run:

```bash
npm run sync
```

This keeps your dependencies in sync with your actual code.

### In CI

Add a check to ensure dependencies are always in sync:

```yaml
# .github/workflows/ci.yml
- name: Check dependencies are in sync
  run: npm run sync:check
```

### Refactoring

When extracting code into a new shared package:

1. Move the code to the new package
2. Update imports in consuming packages
3. Run `npm run sync`
4. Serenity Now handles the rest

## Next Steps

- [Configuration Reference](./configuration.md) - Learn about all configuration options
- [How It Works](./how-it-works.md) - Understand what Serenity Now does under the hood
