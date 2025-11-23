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

### ✅ Enable Incremental Compilation (as a bonus)

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

**Syncpack vs Serenity Now:**

- **Syncpack** ensures your external dependencies (React, Lodash, etc.) use consistent versions across packages
- **Serenity Now** ensures your internal workspace dependencies match your actual imports and TypeScript references

You might use both! Syncpack for `react: ^18.0.0` consistency, Serenity Now for `@myorg/utils: workspace:*` correctness.

---

## 📦 Installation

```bash
npm install -g serenity-now
# or
yarn global add serenity-now
# or
pnpm add -g serenity-now
```

---

## 🚀 Usage

### Basic Commands

```bash
# Check what's out of sync (doesn't change anything)
serenity-now --dry-run

# Fix everything automatically
serenity-now

# See detailed output
serenity-now --verbose

# Check repo health
serenity-now --health
```

### What It Actually Does

When you run `serenity-now`, it:

1. 🔍 **Scans** all TypeScript files for imports
2. 📊 **Builds** a dependency graph of your workspace
3. 🔍 **Compares** actual imports vs package.json dependencies
4. 🔍 **Validates** tsconfig.json references match reality
5. ✏️ **Updates** package.json and tsconfig.json to match (unless `--dry-run`)
6. ✅ **Reports** what changed (or what would change)

---

## ⚙️ Configuration

Create a `serenity-now.json` in your monorepo root:

```json
{
  "organization": {
    "prefix": "@myorg/"
  },
  "workspace": {
    "patterns": ["packages/*", "apps/*"],
    "types": {
      "apps/*": {
        "type": "application"
      },
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

### Configuration Explained

- **`organization.prefix`** - Your workspace package prefix (e.g., `@myorg/`)
- **`workspace.patterns`** - Where your packages live (glob patterns)
- **`workspace.types`** - Categorize packages (apps vs libraries) and enforce rules
- **`dependencies.default`** - Auto-add these to every package
- **`dependencies.ignored`** - Never manage these dependencies
- **`dependencies.typeOnlyInDev`** - Put type-only imports in `devDependencies`

---

## 🏗️ Requirements

- **Node.js** >= 18.0.0
- **TypeScript monorepo** using workspaces:
  - ✅ Yarn workspaces
  - ✅ pnpm workspaces
  - ✅ npm workspaces
- **Every workspace project must have**:
  - `package.json` with a `name` field
  - `tsconfig.json` with `composite: true`

---

## 🧠 Philosophy

Serenity Now follows these principles (see [CLAUDE.md](CLAUDE.md) for details):

### 1️⃣ No Guessing

Don't infer configuration. Don't fall back to "smart" defaults. If something's wrong, say so.

### 2️⃣ Explicit Configuration

Users configure workspace types explicitly. No pattern matching magic.

### 3️⃣ Fail Fast

If a project is misconfigured, report it immediately. Clear errors > silent workarounds.

### 4️⃣ TypeScript-First

Built for TypeScript monorepos. Other languages can coexist, but TS is the focus.

---

## 🎭 Why "serenity-now"?

Because managing monorepo dependencies manually will make you want to scream **"SERENITY NOW!"** at your computer.

This tool brings that serenity, now.

_"These dependencies are real... and they're SPECTACULAR!"_ ✨

---

## 🗺️ Roadmap

- [ ] Publish to npm (in progress)
- [ ] Add `--watch` mode for development
- [ ] Detect and warn about circular dependencies
- [ ] Generate dependency graph visualizations
- [ ] VS Code extension for inline diagnostics
- [ ] Plugin system for custom rules
- [ ] Support for pnpm patches and overrides

---

## 🤝 Contributing

Contributions welcome! This tool was extracted from a real production monorepo at [billie-coop](https://github.com/billie-coop), so it's battle-tested but still evolving.

Found a bug? Have a feature request? [Open an issue](https://github.com/billie-coop/serenity-now/issues).

---

## 📄 License

MIT

---

## 🙏 Acknowledgments

Built with [Deno](https://deno.com) and compiled to Node.js via [@deno/dnt](https://github.com/denoland/dnt).

Inspired by real-world pain managing a large TypeScript monorepo with 60+ packages.

---

**Built with ❤️ and a healthy appreciation for automated sanity.**
