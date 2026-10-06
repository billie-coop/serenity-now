import { DOCS } from "../../docs/content.js";

export function formatHelp(): string {
	const column = (left: string, right: string) =>
		`  ${left.padEnd(28)}${right}`;
	const option = (opt: (typeof DOCS.options)[number]) => {
		const value = "valueName" in opt ? ` <${opt.valueName}>` : "";
		const short = "short" in opt ? `-${opt.short}, ` : "    ";
		return column(`${short}--${opt.name}${value}`, opt.description);
	};

	return [
		`serenity-now - ${DOCS.tagline}`,
		"",
		DOCS.description,
		"",
		"Usage:",
		"  serenity-now [command] [options]",
		"",
		"Commands:",
		...DOCS.commands.map((c) => column(c.name, c.description)),
		"",
		"Options:",
		...DOCS.options.map(option),
		"",
		"Examples:",
		...DOCS.examples.map((e) => column(e.command, e.description)),
		"",
	].join("\n");
}
