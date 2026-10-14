export const DEFAULT_CONFIG_FILENAME = "serenity-now.config.jsonc";

/** Written to the repo root the first time serenity-now runs without a config. */
export const CONFIG_TEMPLATE = `{
	// Serenity Now configuration
	// https://billie-coop.github.io/serenity-now/#reference/configuration

	// Every workspace project must match a pattern; the first match wins.
	"workspaceTypes": {
		"apps/*": {
			"type": "app" // "app" or "shared-package"
			// "subType": "website",
			// "enforceNamePrefix": "@mycompany/",
			// "packageJsonTemplate": { "private": true },
			// "tsconfigTemplate": { "extends": "../../tsconfig.base.json" },
			// "requiresTsconfig": false // for projects without TypeScript
		},
		"packages/*": {
			"type": "shared-package"
		}
	}

	// Version written for workspace dependencies (default "workspace:*").
	// npm workspaces don't support the workspace: protocol, so use "*" there.
	// "workspaceDependencyVersion": "workspace:*",

	// Added to every project's dependencies.
	// "defaultDependencies": [],

	// Expected to be imported everywhere; not reported as diamond dependencies.
	// "universalUtilities": [],

	// Package names to leave out of the workspace entirely.
	// "ignoreProjects": [],

	// Import specifiers to ignore (glob patterns).
	// "ignoreImports": [],

	// Source files to skip, relative to each project root (glob patterns).
	// "excludePatterns": []
}
`;
