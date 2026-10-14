/**
 * Terminal demos for the overview page. The output is real serenity-now
 * output from the repo's example/ monorepo (colors dropped, the config path
 * shortened), so keep it in step with the CLI when output formats change.
 */

export interface Demo {
	id: string;
	label: string;
	/** The code change that leads to this run, shown above the command. */
	edit?: { file: string; lines: string[] };
	command: string;
	output: string;
	exitCode: number;
}

const header = `═══ Loading Configuration ═══
Loading config from ~/acme/serenity-now.config.jsonc

═══ Discovering Workspace ═══
→ Found 5 projects

═══ Analyzing Sources ═══
→ Scanned 5 files in 5 projects
`;

export const DEMOS: Demo[] = [
	{
		id: "add",
		label: "Add an import",
		edit: {
			file: "apps/mobile/src/index.ts",
			lines: [
				`  import { Button } from "@example/ui";`,
				`+ import { formatDate } from "@example/utils";`,
			],
		},
		command: "npx serenity-now",
		output: `${header}
═══ Resolving Dependency Graph ═══
→ 5 projects, 8 workspace dependencies

═══ Updating Files ═══
→ Updated 2 file(s)
@example/mobile: apps/mobile/package.json
  + dependencies["@example/utils"] = "workspace:*"
@example/mobile: apps/mobile/tsconfig.json
  + paths["@example/utils"] = ["../../packages/utils/src/index.ts"]
  + paths["@example/utils/*"] = ["../../packages/utils/src/*"]
  + reference "../../packages/utils"

═══ Summary ═══
  Projects scanned: 5
  Files modified: 2

✅ Updated 2 file(s).`,
		exitCode: 0,
	},
	{
		id: "remove",
		label: "Remove one",
		edit: {
			file: "apps/web/src/index.ts",
			lines: [`- import { ApiClient } from "@example/api-client";`],
		},
		command: "npx serenity-now",
		output: `${header}
═══ Resolving Dependency Graph ═══
→ 5 projects, 6 workspace dependencies

═══ Updating Files ═══
→ Updated 2 file(s)
@example/web: apps/web/package.json
  - dependencies["@example/api-client"] (not imported)
@example/web: apps/web/tsconfig.json
  - paths["@example/api-client"] (not imported)
  - paths["@example/api-client/*"] (not imported)
  - reference "../../packages/api-client" (not imported)

═══ Summary ═══
  Projects scanned: 5
  Files modified: 2

✅ Updated 2 file(s).`,
		exitCode: 0,
	},
	{
		id: "check",
		label: "Check in CI",
		command: "npx serenity-now --check",
		output: `${header}
═══ Resolving Dependency Graph ═══
→ 5 projects, 8 workspace dependencies

═══ Checking Files ═══
→ 2 file(s) need updating
@example/mobile: apps/mobile/package.json
  + dependencies["@example/utils"] = "workspace:*"
@example/mobile: apps/mobile/tsconfig.json
  + paths["@example/utils"] = ["../../packages/utils/src/index.ts"]
  + paths["@example/utils/*"] = ["../../packages/utils/src/*"]
  + reference "../../packages/utils"

═══ Summary ═══
  Projects scanned: 5
  Files to modify: 2

✨ Dry run complete (no files modified).
✗ Files are out of sync. Run serenity-now to fix them.`,
		exitCode: 1,
	},
	{
		id: "health",
		label: "Health report",
		command: "npx serenity-now health",
		output: `${header}
═══ Resolving Dependency Graph ═══
→ 5 projects, 7 workspace dependencies

═══ Health Report ═══
✓ No circular dependencies

Diamond dependencies (1, excluding universal utilities):
  @example/utils (1):
    - @example/web: direct and via @example/api-client, @example/ui

✓ Every shared package is used

Most depended-upon packages:
  - @example/utils: 3 project(s)
  - @example/api-client: 2 project(s)
  - @example/ui: 2 project(s)`,
		exitCode: 0,
	},
	{
		id: "cycle",
		label: "Catch a cycle",
		edit: {
			file: "packages/utils/src/index.ts",
			lines: [`+ import { Button } from "@example/ui";`],
		},
		command: "npx serenity-now",
		output: `${header}
═══ Resolving Dependency Graph ═══
→ 5 projects, 9 workspace dependencies
✗ Found 1 circular dependency cycle(s):
  @example/utils → @example/ui → @example/utils
Use --force to sync anyway.`,
		exitCode: 2,
	},
];
