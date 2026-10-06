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

Build serenity-now (`npm run build` in the repo root), then from the example directory run:

```bash
node ../dist/cli.js --dry-run   # see what would change
node ../dist/cli.js             # update package.json and tsconfig.json files
node ../dist/cli.js health      # cycles, diamonds, unused packages
```

## What to Test

1. **Dependency Detection**: each project's workspace dependencies match its imports.

2. **Template Application**: package.json and tsconfig.json files get the templates for their workspace type.

3. **Dependency Graph**:
   - `web` app depends on `ui`, `api-client`, and `utils`
   - `mobile` app depends on `ui` and `api-client`
   - `ui` depends on `utils`
   - `api-client` depends on `utils`
   - `utils` has no dependencies
