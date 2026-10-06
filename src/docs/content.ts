/**
 * Shared documentation content: the CLI's --help output and argument parser
 * are both built from this, so they can't drift apart.
 */

export interface CliOptionDoc {
	name: string;
	short?: string;
	type: "boolean" | "string";
	valueName?: string;
	description: string;
}

export const DOCS = {
	tagline: "Keep your TypeScript monorepo dependencies in sync",

	description:
		"Serenity Now syncs workspace dependencies in package.json and tsconfig.json with the imports your code actually uses.",

	commands: [
		{
			name: "sync",
			description:
				"Update package.json dependencies and tsconfig.json paths/references (default)",
		},
		{
			name: "health",
			description: "Report circular dependencies, diamonds and unused packages",
		},
		{
			name: "detect-unused-exports",
			description: "List exports of shared packages that nothing imports",
		},
		{
			name: "generate-report",
			description: "Write serenity-now-summary.md with the full analysis",
		},
	],

	options: [
		{
			name: "dry-run",
			short: "d",
			type: "boolean",
			description: "Show what sync would change without writing files",
		},
		{
			name: "check",
			type: "boolean",
			description:
				"Like --dry-run, but exit with code 1 if any file is out of sync (for CI)",
		},
		{
			name: "force",
			short: "f",
			type: "boolean",
			description: "Sync even if there are circular dependencies",
		},
		{
			name: "config",
			short: "c",
			type: "string",
			valueName: "path",
			description:
				"Path to the configuration file (default: serenity-now.config.jsonc)",
		},
		{
			name: "verbose",
			short: "v",
			type: "boolean",
			description: "Show detailed output",
		},
		{
			name: "help",
			short: "h",
			type: "boolean",
			description: "Show this help",
		},
	] satisfies CliOptionDoc[],

	examples: [
		{ command: "serenity-now", description: "Sync dependencies" },
		{ command: "serenity-now --dry-run", description: "Preview changes" },
		{ command: "serenity-now --check", description: "Fail CI if out of sync" },
		{ command: "serenity-now health", description: "Monorepo health report" },
	],
} as const;
