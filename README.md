# 🧘 serenity-now

> **SERENITY NOW!** Your TypeScript monorepo's sanity checker.

Stop manually managing workspace dependencies. Stop hunting down circular imports. Stop guessing if your `tsconfig.json` references are correct. Serenity Now keeps your TypeScript monorepo's internal dependencies in perfect sync with reality.

---

## 🎯 What It Is

**Serenity Now is a sanity manager for TypeScript monorepos.** It scans your actual imports, compares them to your `package.json` dependencies and `tsconfig.json` references, and tells you exactly what's wrong (or fixes it for you).

Think of it as a linter for your workspace architecture.

### The Core Problem It Solves

In a TypeScript monorepo, you need **three things to stay in sync**:

1. **Your actual imports** (`import { foo } from '@myorg/some-package'`)
2. **Your package.json dependencies** (`"dependencies": { "@myorg/some-package": "workspace:*" }`)
3. **Your tsconfig.json references** (`"references": [{ "path": "../some-package" }]`)

When these drift apart, you get:

- ❌ Type checking that doesn't catch real errors
- ❌ Builds that fail mysteriously
- ❌ Incremental compilation that doesn't work
- ❌ No clear view of your dependency graph

**Serenity Now keeps these three in perfect alignment.**

---

## 💡 What It's Actually Good For

### ✅ Type-Check Your Entire Monorepo with One Command

Run `tsc --build` at the root and TypeScript will correctly check your entire workspace, following project references.

### ✅ Extract Code into Internal Packages Fearlessly

Want to pull some shared logic into `@myorg/utils`? Just move the code, import it, run Serenity Now, and everything updates automatically.

### ✅ See Your Architecture at a Glance

Get a clear view of how your packages depend on each other. Spot circular dependencies. Understand your dependency graph.

### ✅ Enable Incremental Compilation

Once your project references are correct, TypeScript's incremental builds actually work. Rebuilding only what changed becomes faster as your monorepo grows.

### ✅ Enforce Sound Architecture

Configure workspace types (apps vs libraries), enforce naming conventions, and prevent architectural violations before they happen.

---

## 🚫 What It's NOT

- **Not a build tool** - Use Nx, Turborepo, or Moon for task running and caching
- **Not a package manager** - Use npm/yarn/pnpm workspaces for dependency installation
- **Not for non-TypeScript monorepos** - It's TypeScript-first (though non-TS projects can coexist)
- **Not trying to be clever** - It doesn't guess. If something's wrong, it tells you.

---

## 🗺️ Where It Fits in the Ecosystem

Modern monorepo tooling is modular. Different tools solve different problems:

| Tool                         | What It Does                                      | Works With Serenity Now?                         |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| **npm/yarn/pnpm workspaces** | Installs dependencies, links workspace packages   | ✅ Yes - Required foundation                     |
| **TypeScript**               | Type-checks your code                             | ✅ Yes - Serenity Now manages project references |
| **Nx / Turborepo / Moon**    | Task running, caching, affected builds            | ✅ Yes - Complementary tools                     |
| **Lerna**                    | Version bumping, publishing                       | ✅ Yes - Independent concerns                    |
| **Syncpack**                 | Enforces consistent 3rd-party dependency versions | ⚠️ Similar goal, different scope\*               |

**\*Syncpack vs Serenity Now:**

- **Syncpack** ensures your external dependencies (React, Lodash, etc.) use consistent versions across packages
- **Serenity Now** ensures your internal workspace dependencies match your actual imports and TypeScript references

You might use both! Syncpack for `react: ^18.0.0` consistency, Serenity Now for `@myorg/utils: workspace:*` correctness.

---

## 📦 Installation

```bash
npm install --save-dev serenity-now
```

---

## 🚀 Quick Start

1. **Create config** (`serenity-now.config.jsonc`):

```jsonc
{
  "workspaceTypes": {
    "app": { "patterns": ["apps/*"] },
    "shared-package": { "patterns": ["packages/*"] },
  },
}
```

2. **Run**: `npx serenity-now`

3. **Add to scripts**:

```json
{
  "scripts": {
    "sync": "serenity-now",
    "sync:check": "serenity-now --dry-run --fail-on-stale"
  }
}
```

---

## 📖 Usage

```bash
serenity-now              # Fix everything automatically
serenity-now --dry-run    # Preview changes without modifying files
serenity-now --verbose    # See detailed output
serenity-now --health     # Show repo health report
serenity-now --help       # Show all options
```

### Options

| Flag                    | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| `--dry-run`, `-d`       | Preview changes without modifying files                                        |
| `--verbose`, `-v`       | Enable verbose logging with detailed output                                    |
| `--config`, `-c <path>` | Path to configuration file (default: serenity-now.config.jsonc)                |
| `--fail-on-stale`       | Exit with error code if stale dependencies found (useful for CI)               |
| `--force`, `-f`         | Continue even if circular dependencies detected                                |
| `--health`              | Show detailed health report (unused packages, circular deps, diamond patterns) |
| `--help`, `-h`          | Show help message                                                              |

---

## ⚙️ Configuration

Create `serenity-now.config.jsonc` in your monorepo root:

```jsonc
{
  // Define workspace types and their glob patterns
  "workspaceTypes": {
    "app": {
      "patterns": ["apps/*"],
      "subTypes": {
        "website": ["apps/web"],
        "api": ["apps/api"],
      },
    },
    "shared-package": {
      "patterns": ["packages/*"],
    },
  },

  // Packages expected to create diamond dependencies (e.g., logging, types)
  "universalUtilities": ["logger", "types"],

  // Enforce naming conventions (optional)
  "packageNamePattern": "^@myorg/",

  // Exclude patterns from import scanning (optional)
  "excludePatterns": ["**/node_modules/**", "**/dist/**", "**/*.test.ts"],
}
```

---

## 🧠 Design Philosophy

**Keep it simple. Don't be clever. Be strict but reasonable.**

### No Guessing

Don't infer configuration. Don't fall back to "smart" defaults. If something's wrong, say so.

### Explicit Configuration

Users configure workspace types explicitly. No pattern matching magic.

### Fail Fast

If a project is misconfigured, report it immediately. Clear errors > silent workarounds.

See [CLAUDE.md](CLAUDE.md) for full details.

---

## 🔧 CI Integration

```yaml
# .github/workflows/ci.yml
- name: Check dependencies are in sync
  run: npm run sync:check
```

```json
{
  "scripts": {
    "sync:check": "serenity-now --dry-run --fail-on-stale"
  }
}
```

---

## 🏗️ Requirements

- **Node.js** >= 20.0.0
- **TypeScript monorepo** using npm/yarn/pnpm workspaces
- Every workspace project must have:
  - `package.json` with a `name` field
  - `tsconfig.json` for TypeScript configuration

---

## 🎭 Why "serenity-now"?

Because managing monorepo dependencies manually will make you want to scream **"SERENITY NOW!"** at your computer.

This tool brings that serenity, now.

_"These dependencies are real... and they're SPECTACULAR!"_ ✨

---

## 📚 Documentation

For more detailed information, check out the [full documentation](./docs/README.md):

- [Getting Started Guide](./docs/getting-started.md)
- [Configuration Reference](./docs/configuration.md)
- [How It Works](./docs/how-it-works.md)

---

## 🤝 Contributing

Contributions welcome! This tool was extracted from a real production monorepo at [billie-coop](https://github.com/billie-coop), so it's battle-tested but still evolving.

Found a bug? Have a feature request? [Open an issue](https://github.com/billie-coop/serenity-now/issues).

---

## 📄 License

MIT

---

**Built with ❤️ and a healthy appreciation for automated sanity.**
