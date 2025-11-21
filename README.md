# serenity-now

> SERENITY NOW! Automatic dependency management for TypeScript monorepos

A TypeScript-first monorepo dependency synchronization tool that keeps your
workspace dependencies in perfect harmony. No more manual dependency management,
no more version mismatches, no more insanity.

## What It Does

`serenity-now` scans your TypeScript monorepo to understand the actual import
relationships between packages, then automatically synchronizes your
`package.json` files and `tsconfig.json` project references to match reality.

It's like having a very detail-oriented assistant who never sleeps and loves
organizing dependencies.

## Features

- 🔍 **AST-based import scanning** - Understands all import types (static,
  dynamic, type-only, require, re-export)
- 📦 **Automatic dependency synchronization** - Updates package.json files based
  on actual usage
- 🔗 **TypeScript project references** - Manages tsconfig.json references and
  path mappings
- 🎯 **Smart defaults** - Zero-config for common monorepo setups
- ⚡ **Fast** - Optimized for large monorepos
- 🔧 **Configurable** - Customize behavior for your specific needs

## Installation

```bash
npm install -g serenity-now
# or
yarn global add serenity-now
# or
pnpm add -g serenity-now
```

## Usage

In your monorepo root:

```bash
# Analyze and update dependencies
serenity-now

# Dry run to see what would change
serenity-now --dry-run

# Verbose output for debugging
serenity-now --verbose
```

## Configuration

Create a `serenity-now.json` file in your monorepo root:

```json
{
  "organization": {
    "prefix": "@myorg/"
  },
  "workspace": {
    "patterns": ["packages/*", "apps/*"],
    "types": {
      "apps/*": { "type": "application" },
      "packages/*": {
        "type": "library",
        "enforcePrefix": true
      }
    }
  },
  "dependencies": {
    "default": ["@myorg/shared-utils"],
    "ignored": ["eslint", "prettier"],
    "typeOnlyInDev": true
  }
}
```

### Zero Config Mode

If no configuration is provided, `serenity-now` will:

- Auto-detect your organization prefix from existing packages
- Use workspace patterns from your root `package.json`
- Detect your package manager (yarn, npm, pnpm)
- Apply sensible defaults

## How It Works

1. **Scan** - Reads all source files in your monorepo
2. **Parse** - Builds a dependency graph from imports
3. **Resolve** - Maps imports to workspace packages
4. **Sync** - Updates package.json and tsconfig.json files
5. **Verify** - Ensures consistency across the monorepo

## Requirements

- Node.js >= 20.0.0
- TypeScript monorepo using:
  - Yarn workspaces (recommended)
  - pnpm workspaces
  - npm workspaces (planned)

## Why "serenity-now"?

Because managing monorepo dependencies manually will make you want to scream
"SERENITY NOW!" at your computer. This tool brings that serenity, now.

_"These dependencies are real... and they're SPECTACULAR!"_

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md)
for details.

## License

MIT

## Roadmap

- [ ] Extract core functionality from billie-coop monorepo
- [ ] Remove hardcoded organization assumptions
- [ ] Add smart auto-detection
- [ ] Support npm workspaces (currently yarn/pnpm only)
- [ ] Plugin system for extensibility
- [ ] Watch mode for development
- [ ] VS Code extension

---

Built with ❤️ and a healthy appreciation for automated dependency management.
