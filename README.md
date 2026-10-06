# 🧘 serenity-now

> **SERENITY NOW!** Your TypeScript monorepo's sanity checker.

<p align="center">
  <img src="./serenity-now.gif" alt="Serenity Now!" width="400">
</p>

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
- **Not a package manager** - Use npm, yarn or bun workspaces for dependency installation
- **Not for non-TypeScript monorepos** - It's TypeScript-first (though non-TS projects can coexist)
- **Not trying to be clever** - It doesn't guess. If something's wrong, it tells you.

---

## 🗺️ Where It Fits in the Ecosystem

Modern monorepo tooling is modular. Different tools solve different problems:

| Tool                         | What It Does                                      | Works With Serenity Now?                         |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| **npm/yarn/bun workspaces**  | Installs dependencies, links workspace packages   | ✅ Yes - Required foundation                     |
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

1. **Run it once**: `npx serenity-now` creates a `serenity-now.config.jsonc` template in your repo root.

2. **Describe your workspace**: every workspace project must match a pattern (the first match wins).

```jsonc
{
  "workspaceTypes": {
    "apps/*": { "type": "app" },
    "packages/*": { "type": "shared-package" },
  },
}
```

3. **Sync**: `npx serenity-now`

4. **Add to scripts**:

```json
{
  "scripts": {
    "sync": "serenity-now",
    "sync:check": "serenity-now --check"
  }
}
```

---

## 📖 Usage

```bash
serenity-now                         # Sync package.json and tsconfig.json files
serenity-now --dry-run               # Preview changes without writing anything
serenity-now --check                 # Exit 1 if anything is out of sync (CI)
serenity-now health                  # Cycles, diamonds, unused packages
serenity-now detect-unused-exports   # Exports of shared packages nothing imports
serenity-now generate-report         # Write serenity-now-summary.md
serenity-now --help                  # Show all commands and options
```

### Options

| Flag                    | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `-d`, `--dry-run`       | Show what sync would change without writing files                   |
| `--check`               | Like `--dry-run`, but exit with code 1 if any file is out of sync   |
| `-f`, `--force`         | Sync even if there are circular dependencies                        |
| `-c`, `--config <path>` | Path to the configuration file (default: serenity-now.config.jsonc) |
| `-v`, `--verbose`       | Show detailed output                                                |
| `-h`, `--help`          | Show help                                                           |

### What sync changes

For every project whose sources it could scan, sync:

- adds each imported workspace package to `dependencies` (unless it's already in `devDependencies` or `peerDependencies`) and removes workspace packages from `dependencies` that nothing imports
- sets `compilerOptions.paths` for imported workspace packages to their source entry points
- adds `references` to imported workspace packages and removes references to ones no longer imported

Everything else in those files (other dependencies, other paths, references to your own tsconfig files, comments and formatting) is left alone. A project whose sources couldn't be scanned is never modified.

Imports are found with the TypeScript 7 compiler in every file each project's tsconfig files include: the root `tsconfig.json`, any `tsconfig.json` in a subdirectory (e.g. a standalone `convex/tsconfig.json`), and tsconfig files those reference inside the project (e.g. Vite's `tsconfig.app.json`). Nested tsconfig files are only read, never modified. Static imports, `export ... from`, `import x = require()`, dynamic `import()`, `require()` and `typeof import()` all count.

---

## ⚙️ Configuration

See the [configuration reference](./docs/configuration.md) for every option. A fuller example:

```jsonc
{
  "workspaceTypes": {
    "apps/*": {
      "type": "app",
      "packageJsonTemplate": { "private": true },
    },
    "packages/*": {
      "type": "shared-package",
      "enforceNamePrefix": "@myorg/",
    },
  },

  // npm workspaces don't support the workspace: protocol
  "workspaceDependencyVersion": "*",

  // Imported everywhere on purpose; not reported as diamond dependencies
  "universalUtilities": ["@myorg/logger"],

  // Source files to skip, relative to each project
  "excludePatterns": ["**/*.stories.tsx"],
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
  run: npx serenity-now --check
```

`--check` fails when any `package.json` or `tsconfig.json` would change, whether a dependency is missing or stale.

---

## 🏗️ Requirements

- **Node.js** >= 22.12
- **Workspaces declared in the root `package.json`** (npm, yarn or bun; pnpm's `pnpm-workspace.yaml` isn't read)
- Every workspace project needs a `package.json` with a `name`, and a `tsconfig.json` (unless its workspace type sets `"requiresTsconfig": false`)
- **TypeScript 7 compatible tsconfig files.** serenity-now analyzes your code with TypeScript 7, so options TypeScript 7 removed (such as `baseUrl` or `moduleResolution: "node"`) are reported as errors
- Packages that other projects import must declare an entry point (`exports`, `types` or `main`). If it points at build output, the package's tsconfig `outDir`/`rootDir` is used to find the source file

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
