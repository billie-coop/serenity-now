# Example Monorepo

This is an example TypeScript monorepo used for testing `serenity-now`.

## Structure

```
example/
├── apps/
│   ├── web/          # Web app that imports from packages
│   └── mobile/       # Mobile app that imports from packages
├── packages/
│   ├── utils/        # Shared utilities
│   ├── ui/           # UI components (depends on utils)
│   └── api-client/   # API client (depends on utils)
└── serenity-now.config.jsonc
```

## Testing

From the example directory, run:

```bash
# Dry run to see what would change
deno run --allow-read --allow-write --allow-env ../cli.ts --dry-run

# Actually update dependencies
deno run --allow-read --allow-write --allow-env ../cli.ts

# Verbose mode to see details
deno run --allow-read --allow-write --allow-env ../cli.ts --verbose
```

## What to Test

1. **Dependency Detection**: All packages start with empty dependencies. The tool should detect imports and add the correct workspace dependencies.

2. **Root TSConfig Management**: The root `tsconfig.json` should be updated with:
   - `composite: true`
   - `incremental: true`
   - `references` to all projects

3. **Template Application**: Package.json and tsconfig.json files should have templates applied based on workspace type configuration.

4. **Dependency Graph**:
   - `web` app should depend on `ui`, `api-client`, and `utils`
   - `mobile` app should depend on `ui` and `api-client`
   - `ui` should depend on `utils`
   - `api-client` should depend on `utils`
   - `utils` should have no dependencies