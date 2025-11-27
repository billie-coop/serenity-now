# Configuration Reference

Serenity Now is configured via `serenity-now.config.jsonc` in your monorepo root.

## Full Configuration Schema

```jsonc
{
  // REQUIRED: Define your workspace types and their configurations
  "workspaceTypes": {
    "apps/*": {
      "type": "app",
      "subType": "website",
      "enforceNamePrefix": false,
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
      "subType": "library",
      "enforceNamePrefix": "@myorg/",
      "packageJsonTemplate": {
        "files": ["dist", "types"],
        "main": "./src/index.ts",
      },
      "tsconfigTemplate": {
        "extends": "../../tsconfig.options",
      },
    },
  },

  // OPTIONAL: Dependencies to include in every project
  "defaultDependencies": ["@myorg/common-types"],

  // OPTIONAL: Packages that are used everywhere (logging, types, etc.)
  "universalUtilities": ["logger", "types"],

  // OPTIONAL: Enforce package naming pattern
  "packageNamePattern": "^@myorg/",

  // OPTIONAL: Additional patterns to exclude from import scanning
  "excludePatterns": ["**/*.test.ts", "**/*.spec.ts"],

  // OPTIONAL: Projects to completely ignore
  "ignoreProjects": ["legacy-app", "deprecated-package"],

  // OPTIONAL: Import patterns to ignore
  "ignoreImports": ["react", "react-dom"],

  // OPTIONAL: TypeScript configuration options
  "tsconfig": {
    "preserveOutDir": true,
    "typeOnlyInDevDependencies": true,
    "incremental": true,
  },
}
```

## Field Descriptions

### `workspaceTypes` (required)

Defines how your monorepo is organized. The key is a glob pattern matching workspace directories.

Each workspace type configuration has:

- **`type`**: Either `"app"` or `"shared-package"`
- **`subType`** (optional): Further categorize (e.g., `"mobile"`, `"website"`, `"library"`)
- **`enforceNamePrefix`** (optional): Package name must start with this string, or `false` to disable
- **`requiresTsconfig`** (optional): Whether `tsconfig.json` is required (default: `true`)
- **`packageJsonTemplate`** (optional): Fields to merge into `package.json`
- **`tsconfigTemplate`** (optional): Fields to merge into `tsconfig.json`

**Example:**

```jsonc
"workspaceTypes": {
  "apps/*-mobile": {
    "type": "app",
    "subType": "mobile",
    "enforceNamePrefix": false,
    "packageJsonTemplate": {
      "private": true,
      "main": "index.js"
    },
    "tsconfigTemplate": {
      "extends": "../../tsconfig.options",
      "include": ["app/**/*", "src/**/*"]
    }
  },
  "packages/*": {
    "type": "shared-package",
    "subType": "library",
    "enforceNamePrefix": "@myorg/",
    "packageJsonTemplate": {
      "files": ["dist"],
      "main": "./src/index.ts",
      "exports": {
        ".": "./src/index.ts"
      }
    }
  }
}
```

**Template Variables:**

- `{{projectDir}}` - The project's directory name

**Why it matters:** These templates ensure consistent structure across your monorepo. Serenity Now will merge these templates into your workspace's `package.json` and `tsconfig.json` files.

### `defaultDependencies` (optional)

Array of package names to automatically include as dependencies in every project.

**Example:**

```jsonc
"defaultDependencies": ["@myorg/ts-utils", "@myorg/common-types"]
```

**Why it matters:** Useful for truly universal utilities that every package needs, like shared TypeScript configuration or utility types.

### `universalUtilities` (optional)

Array of package name suffixes that are expected to be used by many packages.

**Example:**

```jsonc
"universalUtilities": ["logger", "types", "config"]
```

**Why it matters:** These packages commonly create "diamond dependency" patterns. Listing them here prevents warnings about diamond dependencies for these specific packages.

### `packageNamePattern` (optional)

A regex pattern that all workspace package names must match.

**Example:**

```jsonc
"packageNamePattern": "^@acme/"
```

**Why it matters:** Enforces consistent naming conventions across your monorepo. Packages that don't match will trigger warnings.

### `excludePatterns` (optional)

Additional glob patterns to exclude when scanning for imports.

**Default exclusions** (always applied):

- `**/node_modules/**`
- `**/dist/**`
- `**/.git/**`

**Example:**

```jsonc
"excludePatterns": [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/fixtures/**",
  "**/mocks/**"
]
```

**Why it matters:** Excludes test files, generated code, or other directories from import analysis. This prevents test-only dependencies from being added to production `package.json` files.

### `ignoreProjects` (optional)

Array of project names or paths to completely ignore during scanning.

**Example:**

```jsonc
"ignoreProjects": ["legacy-app", "experimental-package"]
```

**Why it matters:** Useful for legacy code or experimental projects that don't follow your monorepo conventions.

### `ignoreImports` (optional)

Array of import specifiers to ignore when analyzing dependencies.

**Example:**

```jsonc
"ignoreImports": ["react", "react-dom", "lodash"]
```

**Why it matters:** External dependencies (from npm) should be ignored when analyzing internal workspace dependencies.

### `tsconfig` (optional)

TypeScript-specific configuration options.

**Fields:**

- **`preserveOutDir`** (default: `false`): Don't modify the `outDir` setting in `tsconfig.json`
- **`typeOnlyInDevDependencies`** (default: `false`): Put type-only imports in `devDependencies` instead of `dependencies`
- **`incremental`** (default: `false`): Enable TypeScript incremental compilation

**Example:**

```jsonc
"tsconfig": {
  "preserveOutDir": true,
  "typeOnlyInDevDependencies": true,
  "incremental": true
}
```

## Real-World Example

For a complete, production-ready configuration, see the [billie-coop monorepo config](https://github.com/billie-coop/billie-coop-monorepo/blob/main/serenity-now.config.jsonc).

## Configuration Location

By default, Serenity Now looks for `serenity-now.config.jsonc` in the monorepo root.

You can specify a custom path:

```bash
npx serenity-now --config path/to/custom-config.jsonc
```

## JSONC Support

The configuration file supports JSONC (JSON with Comments), so you can add comments to document your choices:

```jsonc
{
  // Our apps live in the apps/ directory
  "workspaceTypes": {
    "apps/*": {
      "type": "app",
      "packageJsonTemplate": {
        "private": true, // Apps are never published
      },
    },
  },

  // Logger is used everywhere, so diamond deps are expected
  "universalUtilities": ["logger"],
}
```
