# Configuration Reference

Serenity Now is configured via `serenity-now.config.jsonc` in your monorepo root.

## Configuration Schema

```jsonc
{
  // REQUIRED: Define your workspace types and their glob patterns
  "workspaceTypes": {
    "app": {
      "patterns": ["apps/*"],
      "subTypes": {
        "website": ["apps/web"],
        "api": ["apps/api"]
      }
    },
    "shared-package": {
      "patterns": ["packages/*"]
    }
  },

  // OPTIONAL: Packages that are used everywhere (logging, types, etc.)
  "universalUtilities": ["logger", "types"],

  // OPTIONAL: Enforce package naming pattern
  "packageNamePattern": "^@myorg/",

  // OPTIONAL: Additional patterns to exclude from import scanning
  "excludePatterns": ["**/node_modules/**", "**/dist/**", "**/*.test.ts"]
}
```

## Field Descriptions

### `workspaceTypes` (required)

Defines how your monorepo is organized. Each workspace type has:

- **Key**: A name for the type (e.g., `"app"`, `"shared-package"`)
- **`patterns`**: Array of glob patterns matching workspace directories
- **`subTypes`** (optional): Further categorize workspaces within a type

**Example:**

```jsonc
"workspaceTypes": {
  "app": {
    "patterns": ["apps/*"],
    "subTypes": {
      "frontend": ["apps/web", "apps/mobile"],
      "backend": ["apps/api", "apps/worker"]
    }
  },
  "library": {
    "patterns": ["packages/*"]
  }
}
```

**Why it matters:** Serenity Now uses this to understand your monorepo structure and can enforce architectural rules based on workspace types.

### `universalUtilities` (optional)

Array of package name suffixes that are expected to be used by many packages.

**Example:**

```jsonc
"universalUtilities": ["logger", "types", "config"]
```

**Why it matters:** These packages commonly create "diamond dependency" patterns (where multiple packages depend on the same utility). Listing them here prevents false warnings about diamond dependencies.

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

## Example Configurations

### Basic Monorepo

```jsonc
{
  "workspaceTypes": {
    "app": {
      "patterns": ["apps/*"]
    },
    "package": {
      "patterns": ["packages/*"]
    }
  }
}
```

### Advanced Monorepo

```jsonc
{
  "workspaceTypes": {
    "app": {
      "patterns": ["apps/*"],
      "subTypes": {
        "web": ["apps/web", "apps/admin"],
        "api": ["apps/api", "apps/graphql"]
      }
    },
    "shared-library": {
      "patterns": ["packages/shared/*"]
    },
    "internal-tool": {
      "patterns": ["tools/*"]
    }
  },
  "universalUtilities": ["logger", "types", "config", "constants"],
  "packageNamePattern": "^@mycompany/",
  "excludePatterns": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/test-utils/**"
  ]
}
```

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
    "app": {
      "patterns": ["apps/*"]
    }
  },
  
  // Logger is used everywhere, so diamond deps are expected
  "universalUtilities": ["logger"]
}
```
