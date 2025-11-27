# Serenity Now Documentation

Welcome to the Serenity Now docs. Pick your starting point:

## 📚 Guides

- **[Getting Started](./getting-started.md)** - Install and set up Serenity Now in your monorepo
- **[Configuration Reference](./configuration.md)** - Complete guide to all configuration options
- **[How It Works](./how-it-works.md)** - Understand what Serenity Now does and why it matters

## Quick Links

- [Main README](../README.md) - Project overview and feature list
- [GitHub Issues](https://github.com/billie-coop/serenity-now/issues) - Report bugs or request features

## Common Questions

### When should I run Serenity Now?

Run it whenever you add or remove imports to workspace packages. Many teams run it:
- After pulling changes (`npm run sync`)
- Before committing (`pre-commit` hook)
- In CI to verify everything stays in sync

### What if I have circular dependencies?

Serenity Now will detect and report them. Circular dependencies break TypeScript's incremental compilation, so you'll need to refactor to remove the cycle.

### Do I need to commit the config changes?

Yes! The `package.json` and `tsconfig.json` changes should be committed so everyone on your team has the same dependency setup.

### Can I use this with Nx/Turborepo?

Absolutely. Serenity Now handles TypeScript project references and dependency sync. Nx/Turborepo handle task running and caching. They complement each other.
