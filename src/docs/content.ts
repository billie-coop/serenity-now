/**
 * Shared documentation content used by both CLI --help and docs website
 */

export const DOCS = {
	tagline: "Keep your TypeScript monorepo dependencies in sync",

	description:
		"Serenity Now automatically syncs workspace dependencies in package.json and tsconfig.json based on actual import usage.",

	why: {
		title: "Why Serenity Now?",
		points: [
			{
				problem: "Manual dependency management is tedious and error-prone",
				solution:
					"Serenity Now scans your imports and automatically updates dependencies",
			},
			{
				problem: "TypeScript incremental builds break with missing references",
				solution:
					"Automatically maintains tsconfig.json references for correct build order",
			},
			{
				problem: "Package.json and tsconfig.json get out of sync",
				solution: "Single source of truth: your actual import statements",
			},
			{
				problem: "Stale dependencies accumulate over time",
				solution:
					"Detects and warns about unused workspace dependencies you can remove",
			},
		],
	},

	features: [
		"Scans TypeScript/JavaScript imports to find workspace dependencies",
		"Updates package.json dependencies automatically",
		"Maintains tsconfig.json references for incremental compilation",
		"Detects circular dependencies",
		"Identifies diamond dependency patterns",
		"Warns about stale/unused dependencies",
		"Dry-run mode to preview changes",
		"Configurable workspace types and patterns",
	],

	usage: {
		basic: "serenity-now",
		dryRun: "serenity-now --dry-run",
		verbose: "serenity-now --verbose",
		config: "serenity-now --config custom-config.json",
		health: "serenity-now --health",
	},

	options: [
		{
			flag: "--dry-run, -d",
			description: "Preview changes without modifying files",
		},
		{
			flag: "--verbose, -v",
			description: "Enable verbose logging with detailed output",
		},
		{
			flag: "--config, -c <path>",
			description:
				"Path to configuration file (default: serenity-now.config.jsonc)",
		},
		{
			flag: "--fail-on-stale",
			description:
				"Exit with error code if stale dependencies are found (useful for CI)",
		},
		{
			flag: "--force, -f",
			description: "Continue execution even if circular dependencies are detected",
		},
		{
			flag: "--health",
			description:
				"Show detailed health report including unused packages and dependency patterns",
		},
		{
			flag: "--help, -h",
			description: "Show help message",
		},
	],

	configFile: {
		name: "serenity-now.config.jsonc",
		example: `{
  // Define workspace types and their glob patterns
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

  // Packages that are expected to create diamond dependencies
  "universalUtilities": ["logger", "types"],

  // Custom naming conventions
  "packageNamePattern": "^@myorg/",

  // Patterns to exclude from import scanning
  "excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/*.test.ts"
  ]
}`,
	},

	philosophy: {
		title: "Design Philosophy",
		principles: [
			{
				name: "No Guessing",
				description:
					"Don't infer or guess configuration. If something is wrong, warn or error - don't silently adapt.",
			},
			{
				name: "Explicit Configuration",
				description:
					"Users should explicitly configure workspace types. No 'clever' pattern matching.",
			},
			{
				name: "Strict but Reasonable Rules",
				description:
					"Every project must have tsconfig.json (required for incremental compilation). Clear errors are better than silent workarounds.",
			},
			{
				name: "Fail Fast",
				description:
					"If a project is misconfigured, report it immediately. Don't try to work around missing configuration.",
			},
		],
	},

	examples: [
		{
			title: "Basic sync",
			command: "serenity-now",
			description:
				"Scans all imports and updates package.json + tsconfig.json files",
		},
		{
			title: "Preview changes",
			command: "serenity-now --dry-run",
			description: "Shows what would change without modifying any files",
		},
		{
			title: "Check in CI",
			command: "serenity-now --dry-run --fail-on-stale",
			description:
				"Fails CI build if dependencies are out of sync or stale deps exist",
		},
		{
			title: "Monorepo health check",
			command: "serenity-now --health",
			description:
				"Shows detailed report of unused packages, circular deps, and diamond patterns",
		},
		{
			title: "Detailed logging",
			command: "serenity-now --verbose",
			description: "See exactly what the tool is doing at each step",
		},
	],

	quickStart: `1. Install:
   npm install --save-dev serenity-now

2. Create config file (serenity-now.config.jsonc):
   {
     "workspaceTypes": {
       "app": { "patterns": ["apps/*"] },
       "shared-package": { "patterns": ["packages/*"] }
     }
   }

3. Run:
   npx serenity-now

4. Add to package.json scripts:
   "scripts": {
     "sync": "serenity-now",
     "sync:check": "serenity-now --dry-run --fail-on-stale"
   }`,
} as const;
