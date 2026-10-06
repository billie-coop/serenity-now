import { type ParseArgsConfig, parseArgs } from "node:util";
import { DOCS } from "../../docs/content.js";

export type Command = (typeof DOCS.commands)[number]["name"];

export interface CliArgs {
	command: Command;
	help: boolean;
	dryRun: boolean;
	check: boolean;
	force: boolean;
	verbose: boolean;
	config?: string;
}

/** The command line is invalid; the message says why. */
export class UsageError extends Error {
	override name = "UsageError";
}

const PARSE_OPTIONS: NonNullable<ParseArgsConfig["options"]> =
	Object.fromEntries(
		DOCS.options.map((opt) => [
			opt.name,
			"short" in opt
				? { type: opt.type, short: opt.short }
				: { type: opt.type },
		]),
	);

export function parseCliArgs(argv: string[]): CliArgs {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args: argv,
			options: PARSE_OPTIONS,
			allowPositionals: true,
			strict: true,
		});
	} catch (error) {
		throw new UsageError((error as Error).message);
	}

	const { values, positionals } = parsed;
	if (positionals.length > 1) {
		throw new UsageError(`Expected one command, got: ${positionals.join(" ")}`);
	}
	const commandNames: readonly string[] = DOCS.commands.map((c) => c.name);
	const command = positionals[0] ?? "sync";
	if (!commandNames.includes(command)) {
		throw new UsageError(
			`Unknown command "${command}". Commands: ${commandNames.join(", ")}`,
		);
	}

	const args: CliArgs = {
		command: command as Command,
		help: values.help === true,
		dryRun: values["dry-run"] === true,
		check: values.check === true,
		force: values.force === true,
		verbose: values.verbose === true,
		config: typeof values.config === "string" ? values.config : undefined,
	};

	if (args.command !== "sync") {
		const syncOnly = (["dry-run", "check", "force"] as const).filter(
			(name) => values[name] === true,
		);
		if (syncOnly.length > 0) {
			throw new UsageError(
				`--${syncOnly.join(", --")} only applies to the sync command`,
			);
		}
	}
	return args;
}
