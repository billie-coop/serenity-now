# Configuration Reference

Serenity Now is configured with `serenity-now.config.jsonc` in your monorepo root (JSON with comments and trailing commas). Use `--config <path>` to load a different file; a missing `--config` file is an error.

The first time you run serenity-now without a config, it writes a commented template to `serenity-now.config.jsonc` and exits.

Every option is validated. Unknown options, wrong types and invalid values are reported together, so a typo like `"workspaceType"` fails loudly instead of being ignored.

## Full Schema

```jsonc
{
  // REQUIRED: how your workspace is organized
  "workspaceTypes": {
    "apps/*": {
      "type": "app",
      "subType": "website",
      "requiresTsconfig": true,
      "packageJsonTemplate": {
        "private": true,
      },
      "tsconfigTemplate": {
        "extends": "../../tsconfig.options",
        "compilerOptions": {
          "outDir": "../../.moon/cache/types/apps/{{projectDir}}",
        },
      },
    },
    "packages/*": {
      "type": "shared-package",
      "enforceNamePrefix": "@myorg/",
    },
  },

  // OPTIONAL (default "workspace:*"): version written for workspace dependencies
  "workspaceDependencyVersion": "workspace:*",

  // OPTIONAL: added to every project's dependencies
  "defaultDependencies": ["@myorg/common-types"],

  // OPTIONAL: imported everywhere on purpose; not reported as diamonds
  "universalUtilities": ["@myorg/logger"],

  // OPTIONAL: package names to leave out of the workspace entirely
  "ignoreProjects": ["legacy-app"],

  // OPTIONAL: import specifiers to ignore (glob patterns)
  "ignoreImports": ["@myorg/generated-*"],

  // OPTIONAL: source files to skip, relative to each project root (glob patterns)
  "excludePatterns": ["**/*.stories.tsx"],
}
```

## `workspaceTypes` (required)

Keys are glob patterns matched against each workspace project's directory, relative to the repo root (e.g. `apps/web`). **Patterns are checked in the order they appear and the first match wins**, so put exact keys and specific globs (`apps/tracker-mobile`, `apps/*-mobile`) before catch-alls (`apps/*`). A project that matches no pattern is an error. List a project in `ignoreProjects` to leave it out.

Each entry has:

- **`type`** (required): `"app"` or `"shared-package"`. Only shared packages are analyzed by `detect-unused-exports`.
- **`subType`**: one of `mobile`, `db`, `marketing`, `plugin`, `ui`, `website`, `library`, `other`.
- **`enforceNamePrefix`**: package names must start with this string (an error otherwise). `false` means no prefix is enforced.
- **`requiresTsconfig`** (default `true`): whether the project must have a root `tsconfig.json`. Without one, the project is still scanned through any nested `tsconfig.json` files (e.g. `convex/tsconfig.json`) and its `package.json` is synced; with no tsconfig files at all it can't be scanned, so sync never modifies it.
- **`packageJsonTemplate`**: fields merged into the project's `package.json` on every sync.
- **`tsconfigTemplate`**: fields merged into the project's `tsconfig.json` on every sync.

Templates merge objects recursively and replace any other value (including arrays). `{{projectDir}}` in a string becomes the project's directory name.

## `workspaceDependencyVersion`

The version sync writes for workspace dependencies (default `"workspace:*"`, which yarn and bun understand). npm workspaces don't support the `workspace:` protocol, so use `"*"` with npm. Existing workspace dependencies with a different version are updated to match.

## `defaultDependencies`

Workspace packages added to every project's dependencies (except themselves), whether or not they're imported. Each must be a workspace package. Diamonds through these packages are expected and not reported as problems.

## `universalUtilities`

Workspace packages that are meant to be imported everywhere (a logger, shared types). A project that imports one directly and also through another dependency is a "diamond". Diamonds through these packages are reported as expected rather than as a sign of an incomplete abstraction.

## `ignoreProjects`

Package names to leave out of the workspace: they aren't scanned, synced or required to match a workspace type.

## `ignoreImports`

Glob patterns of import specifiers to ignore, e.g. `"@myorg/generated-*"`. Imports of non-workspace packages are always ignored, so you don't need to list npm packages.

## `excludePatterns`

Glob patterns of source files and nested `tsconfig.json` files to skip, relative to each project's root (e.g. `"**/*.stories.tsx"`, `"fixtures/**"`). Without this option, serenity-now scans exactly the files each project's tsconfig includes. There are no hidden default exclusions; `node_modules` is the only thing always skipped.

Excluding files can make sync remove dependencies that only those files import.

## Removed options

These options are rejected with a message explaining why:

- `tsconfig` (`incremental`, `preserveOutDir`, `typeOnlyInDevDependencies`): these never had any effect.
- Top-level `enforceNamePrefix`: set it per entry in `workspaceTypes` instead.

## Real-World Example

For a production configuration, see the [billie-coop monorepo config](https://github.com/billie-coop/billie-coop-monorepo/blob/main/serenity-now.config.jsonc).
