# Getting Started

A quick guide to get Serenity Now running in your TypeScript monorepo.

## Prerequisites

- Node.js >= 20.0.0
- A TypeScript monorepo using npm/yarn/pnpm workspaces
- Every workspace project must have:
  - `package.json` with a `name` field
  - `tsconfig.json` for TypeScript configuration

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
    "app": {
      "patterns": ["apps/*"],
    },
    "shared-package": {
      "patterns": ["packages/*"],
    },
  },
}
```

The `workspaceTypes` configuration is **required**. It tells Serenity Now how your monorepo is organized. Adjust the patterns to match your actual directory structure.

### 3. Run and Verify

After configuring your workspace types, run Serenity Now to sync your dependencies:

```bash
npx serenity-now --verbose
```

This will:

- Scan your imports to find internal workspace dependencies
- Update `package.json` dependencies to match actual imports
- Update `tsconfig.json` references for TypeScript project references
- Remove unused dependencies and references

### 4. Set Up TypeScript Configuration (Recommended)

For best results with TypeScript project references, use a two-file setup:

**Root `tsconfig.json`** - Just for project references (managed by Serenity Now):

```jsonc
{
  "files": [],
  "references": [
    // Serenity Now manages these references
    { "path": "./apps/web" },
    { "path": "./packages/utils" },
  ],
}
```

**Root `tsconfig.options.json`** - Your actual compiler options:

```jsonc
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
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
    "sync:check": "serenity-now --dry-run --fail-on-stale"
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
