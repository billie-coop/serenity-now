# serenity-now

[![npm](https://img.shields.io/npm/v/serenity-now?label=npm)](https://www.npmjs.com/package/serenity-now)
[![CI](https://github.com/billie-coop/serenity-now/actions/workflows/ci.yml/badge.svg)](https://github.com/billie-coop/serenity-now/actions/workflows/ci.yml)

Keeps your TypeScript monorepo's workspace dependencies, tsconfig `paths` and project `references` in sync with the imports your code actually uses.

```bash
npx serenity-now
```

<p align="center">
  <img src="https://raw.githubusercontent.com/billie-coop/serenity-now/main/serenity-now.gif" alt="Frank Costanza yelling &quot;Serenity now!&quot;" width="360">
</p>

**Docs:** [billie-coop.github.io/serenity-now](https://billie-coop.github.io/serenity-now/)

## Why

In a TypeScript monorepo, three things have to agree:

1. **Your imports**: `import { formatDate } from "@myorg/utils"`
2. **`package.json` dependencies**: `"@myorg/utils": "workspace:*"`
3. **`tsconfig.json` paths and references**: `{ "path": "../../packages/utils" }`

They drift apart every time someone adds, moves or deletes an import. When they do, `tsc --build` builds in the wrong order or not at all, incremental compilation quietly stops being incremental, and the dependency graph in your head stops matching the one on disk.

serenity-now reads your imports with the TypeScript compiler and rewrites the other two to match. Run it after changing imports, and run `--check` in CI so drift never lands.

It is **not** a build tool (use Nx, Turborepo or Moon for task running and caching), a package manager, or a version aligner for third-party dependencies (that's [Syncpack](https://github.com/JamieMason/syncpack)'s job; the two work well together).

## Quick start

1. **Generate a config.** From the monorepo root:

   ```bash
   npx serenity-now
   ```

   With no config yet, this writes a commented `serenity-now.config.jsonc` template and exits.

2. **Describe your workspace.** Every workspace project must match a pattern, and the first match wins:

   ```jsonc
   {
     "workspaceTypes": {
       "apps/*": { "type": "app" },
       "packages/*": { "type": "shared-package" },
     },
   }
   ```

   Using npm workspaces? Also set `"workspaceDependencyVersion": "*"`, because npm doesn't support the `workspace:` protocol.

3. **Preview, then sync:**

   ```bash
   npx serenity-now --dry-run   # show what would change
   npx serenity-now             # write it
   ```

4. **Pin it** so your team and CI run the same version:

   ```bash
   npm install --save-dev serenity-now
   ```

   ```json
   {
     "scripts": {
       "sync": "serenity-now",
       "sync:check": "serenity-now --check"
     }
   }
   ```

## What sync changes

Add an import of `@example/utils` to the mobile app, and serenity-now adds the dependency, the `paths` entries and the project reference:

```text
$ npx serenity-now --dry-run
...
═══ Checking Files ═══
→ 2 file(s) need updating
@example/mobile: apps/mobile/package.json
  + dependencies["@example/utils"] = "workspace:*"
@example/mobile: apps/mobile/tsconfig.json
  + paths["@example/utils"] = ["../../packages/utils/src/index.ts"]
  + paths["@example/utils/*"] = ["../../packages/utils/src/*"]
  + reference "../../packages/utils"
```

Delete the last import of a package and they're removed again:

```text
@example/web: apps/web/package.json
  - dependencies["@example/api-client"] (not imported)
@example/web: apps/web/tsconfig.json
  - paths["@example/api-client"] (not imported)
  - paths["@example/api-client/*"] (not imported)
  - reference "../../packages/api-client" (not imported)
```

For every project whose sources it could scan, sync:

- adds each imported workspace package to `dependencies`, unless it's already in `devDependencies` or `peerDependencies`
- removes workspace packages from `dependencies` that nothing imports
- sets `compilerOptions.paths` for imported workspace packages to their source entry points
- adds `references` to imported workspace packages and removes references to ones no longer imported
- applies the `packageJsonTemplate` and `tsconfigTemplate` of the project's workspace type

Everything else is left alone: third-party dependencies, `devDependencies` and `peerDependencies`, your own `paths`, references to non-workspace tsconfig files, comments and formatting. A project whose sources couldn't be scanned is never modified.

## Commands

```bash
serenity-now                         # sync package.json and tsconfig.json files
serenity-now --dry-run               # preview changes without writing anything
serenity-now --check                 # exit 1 if anything is out of sync (CI)
serenity-now health                  # circular dependencies, diamonds, unused packages
serenity-now detect-unused-exports   # exports of shared packages that nothing imports
serenity-now generate-report         # write serenity-now-summary.md
serenity-now --help                  # show all commands and options
```

| Option                  | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `-d`, `--dry-run`       | Show what sync would change without writing files                    |
| `--check`               | Like `--dry-run`, but exit with code 1 if any file is out of sync    |
| `-f`, `--force`         | Sync even if there are circular dependencies                         |
| `-c`, `--config <path>` | Path to the configuration file (default `serenity-now.config.jsonc`) |
| `-v`, `--verbose`       | Show detailed output                                                 |
| `-h`, `--help`          | Show help                                                            |

Exit codes: `0` on success, `1` for errors (config, tsconfig or workspace problems, or `--check` finding drift), `2` when sync stops because of circular dependencies.

### In CI

```yaml
- name: Check workspace dependencies are in sync
  run: npx serenity-now --check
```

`--check` fails when any `package.json` or `tsconfig.json` would change, whether a dependency is missing or stale.

## Configuration

serenity-now reads `serenity-now.config.jsonc` from the monorepo root (JSON with comments and trailing commas). `--config <path>` loads a different file, and a missing `--config` file is an error.

Every option is validated. Unknown options, wrong types and invalid values are reported together, so a typo like `"workspaceType"` fails loudly instead of being ignored.

```jsonc
{
  // REQUIRED: how your workspace is organized
  "workspaceTypes": {
    "apps/*": {
      "type": "app",
      "subType": "website",
      "packageJsonTemplate": { "private": true },
      "tsconfigTemplate": {
        "extends": "../../tsconfig.options.json",
        "compilerOptions": { "outDir": "../../dist/{{projectDir}}" },
      },
    },
    "packages/*": {
      "type": "shared-package",
      "enforceNamePrefix": "@myorg/",
    },
  },

  // Version written for workspace dependencies (default "workspace:*")
  "workspaceDependencyVersion": "workspace:*",

  // Added to every project's dependencies
  "defaultDependencies": ["@myorg/common-types"],

  // Imported everywhere on purpose; not reported as diamonds
  "universalUtilities": ["@myorg/logger"],

  // Package names to leave out of the workspace entirely
  "ignoreProjects": ["legacy-app"],

  // Import specifiers to ignore (glob patterns)
  "ignoreImports": ["@myorg/generated-*"],

  // Source files to skip, relative to each project root (glob patterns)
  "excludePatterns": ["**/*.stories.tsx"],
}
```

### `workspaceTypes` (required)

Keys are glob patterns matched against each workspace project's directory, relative to the repo root (e.g. `apps/web`). **Patterns are checked in the order they appear and the first match wins**, so put exact keys and specific globs (`apps/tracker-mobile`, `apps/*-mobile`) before catch-alls (`apps/*`). A project that matches no pattern is an error; list it in `ignoreProjects` to leave it out.

Each entry has:

- **`type`** (required): `"app"` or `"shared-package"`. Only shared packages are analyzed by `detect-unused-exports`.
- **`subType`**: one of `mobile`, `db`, `marketing`, `plugin`, `ui`, `website`, `library`, `other`.
- **`enforceNamePrefix`**: package names must start with this string, or it's an error. `false` enforces no prefix.
- **`requiresTsconfig`** (default `true`): whether the project must have a root `tsconfig.json`. Without one, the project is still scanned through any nested `tsconfig.json` files (e.g. `convex/tsconfig.json`) and its `package.json` is synced. With no tsconfig files at all it can't be scanned, so sync never modifies it.
- **`packageJsonTemplate`**: fields merged into the project's `package.json` on every sync.
- **`tsconfigTemplate`**: fields merged into the project's `tsconfig.json` on every sync.

Templates merge objects recursively and replace any other value, including arrays. `{{projectDir}}` in a string becomes the project's directory name.

### `workspaceDependencyVersion`

The version sync writes for workspace dependencies. The default `"workspace:*"` works with yarn and bun. npm workspaces don't support the `workspace:` protocol, so use `"*"` there. Existing workspace dependencies with a different version are updated to match.

### `defaultDependencies`

Workspace packages added to every project's dependencies (except their own), whether or not they're imported. Each must be a workspace package. Diamonds through these packages are expected and not reported.

### `universalUtilities`

Workspace packages meant to be imported everywhere, like a logger or shared types. Diamonds through these packages are reported as expected rather than as a sign of an incomplete abstraction. See [Health checks](#health-checks).

### `ignoreProjects`

Package names to leave out of the workspace: they aren't scanned, synced or required to match a workspace type.

### `ignoreImports`

Glob patterns of import specifiers to ignore, e.g. `"@myorg/generated-*"`. Imports of non-workspace packages are always ignored, so you don't need to list npm packages.

### `excludePatterns`

Glob patterns of source files and nested `tsconfig.json` files to skip, relative to each project's root (e.g. `"**/*.stories.tsx"`, `"fixtures/**"`). Without this option, serenity-now scans exactly the files each project's tsconfig includes. There are no hidden default exclusions; `node_modules` is the only thing always skipped.

Excluding files can make sync remove dependencies that only those files import.

### Removed options

These are rejected with a message explaining why:

- `tsconfig` (`incremental`, `preserveOutDir`, `typeOnlyInDevDependencies`): these never had any effect.
- Top-level `enforceNamePrefix`: set it per entry in `workspaceTypes` instead.

## How it works

Every command runs the same steps: load and validate the config, find workspace projects from the root `package.json` `workspaces` globs, scan their sources, and build the dependency graph. Config errors, tsconfig errors and workspace problems all stop the run before anything is written.

### Finding imports

serenity-now loads each project's tsconfig files with the TypeScript 7 compiler:

- the project's `tsconfig.json`
- any `tsconfig.json` in a subdirectory, like a standalone `convex/tsconfig.json`
- tsconfig files those reference inside the project, like Vite's `tsconfig.app.json`

Nested tsconfig files only add sources to scan. serenity-now never writes to them, so they don't need `composite`.

It then reads every file those configs include, wherever it lives (`src/`, `app/`, `pages/`), and records imports of other workspace packages. All of these count:

```typescript
import { helper } from "@myorg/utils";
import type { User } from "@myorg/types";
export { Button } from "@myorg/ui";
import legacy = require("@myorg/legacy");
const charts = await import("@myorg/charts");
type Api = typeof import("@myorg/api");
```

`require()` calls count too.

### Entry points

`paths` point at the imported package's **source** entry point, so editors and `tsc` resolve workspace packages without building them first. The entry point is whatever the package's `package.json` declares: `exports["."]`, then `types`, then `main`/`module`. There's no `src/index.ts` fallback, so a package that other projects import must declare one.

If the entry point is build output inside the package's tsconfig `outDir`, it's mapped back to the matching file under `rootDir`.

### Health checks

`serenity-now health` reports:

- **Circular dependencies.** These break project references and incremental compilation, so sync refuses to run while there are any. `--force` overrides that, but the fix is to break the cycle.
- **Diamond dependencies.** A project that imports a package directly and also through another dependency:

  ```text
          app-web
         /       \
        v         v
    ui-kit ---> shared-utils   <- app-web reaches shared-utils twice
  ```

  Diamonds are fine for genuinely shared things like logging, config or common types; list those in `universalUtilities`. Otherwise they can point at a missing abstraction, like `app-web` going around `data-access` to reach `database-utils` directly. If `universalUtilities` keeps growing, it's worth a look at the architecture.

- **Unused packages.** Shared packages that no project imports.

`detect-unused-exports` goes a level deeper and lists the exports of each shared package that nothing imports. `generate-report` writes all of it to `serenity-now-summary.md`.

## Recommended tsconfig setup

Project references work best with the compiler options in one shared file and a solution-style root `tsconfig.json` that only lists projects.

Root `tsconfig.json` (you maintain this list; serenity-now manages references _between_ projects):

```jsonc
{
  "files": [],
  "references": [{ "path": "./apps/web" }, { "path": "./packages/utils" }],
}
```

Root `tsconfig.options.json`, your compiler settings:

```jsonc
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "strict": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
  },
}
```

Each project's `tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.options.json",
  "compilerOptions": { "outDir": "./dist" },
  "include": ["src/**/*"],
  // paths and references are managed by serenity-now
}
```

Then `tsc --build` at the root type-checks the whole monorepo in dependency order and only rebuilds what changed. To keep the per-project boilerplate consistent, put it in `tsconfigTemplate`.

## Requirements

- **Node.js** 22.12 or later.
- **Workspaces declared in the root `package.json`** (npm, yarn or bun). pnpm's `pnpm-workspace.yaml` isn't read.
- Every workspace project needs a `package.json` with a `name`, and a `tsconfig.json` unless its workspace type sets `"requiresTsconfig": false`.
- **tsconfig files that TypeScript 7 accepts.** serenity-now analyzes your code with TypeScript 7 (the native compiler), so options it removed, such as `baseUrl` or `moduleResolution: "node"`, are reported as errors. Your own build can stay on whatever TypeScript version you like.
- Packages that other projects import must declare an entry point (`exports`, `types` or `main`).

## Design philosophy

**Keep it simple. Don't be clever. Be strict but reasonable.**

- **No guessing.** Workspace types are configured, not inferred from directory names. Only `tsconfig.json` is a project's config, with no fallback to other file names. Entry points come from `package.json`, not convention.
- **Fail fast.** A misconfigured project is an error, not something to quietly work around.
- **Safe edits.** Only workspace entries are ever removed, files are edited in place so comments and formatting survive, and a project whose sources weren't scanned is never touched.

## FAQ

**When should I run it?** Whenever imports between workspace packages change. Common spots are a `sync` script you run while developing, a pre-commit hook, and `--check` in CI.

**Do I commit the changes?** Yes. The `package.json` and `tsconfig.json` edits are part of your repo, so everyone gets the same setup.

**Does it work with Nx, Turborepo or Moon?** Yes. They run tasks; serenity-now keeps the dependency declarations they (and TypeScript) read correct.

## Why "serenity-now"?

Because keeping monorepo dependencies in sync by hand will have you yelling **"SERENITY NOW!"** at your monitor. This brings the serenity. Now.

_"These dependencies are real... and they're spectacular."_

## Contributing

serenity-now was extracted from the [billie-coop](https://github.com/billie-coop) production monorepo. Bug reports and feature requests are welcome in [issues](https://github.com/billie-coop/serenity-now/issues).

The repo uses yarn 4 (pinned in `package.json`; `corepack enable` picks it up).

```bash
yarn install
yarn test           # vitest
yarn check          # biome + tsc
yarn build          # compile the CLI to dist/
yarn cli --help     # run the CLI from source
yarn dev            # run the docs site locally
```

[`docs/architecture.md`](https://github.com/billie-coop/serenity-now/blob/main/docs/architecture.md) maps the code. The docs site lives in [`website/`](https://github.com/billie-coop/serenity-now/tree/main/website) and renders this README.

## License

MIT
