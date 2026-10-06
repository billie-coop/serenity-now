/**
 * A misconfiguration the user has to fix. Collects every problem found so they
 * can all be reported at once instead of one per run.
 */
export class ConfigurationError extends Error {
	readonly problems: string[];

	constructor(summary: string, problems: string[] = []) {
		super(
			problems.length > 0
				? `${summary}\n${problems.map((p) => `  - ${p}`).join("\n")}`
				: summary,
		);
		this.name = "ConfigurationError";
		this.problems = problems;
	}
}

/** Throws a ConfigurationError if any problems were collected. */
export function throwIfProblems(summary: string, problems: string[]): void {
	if (problems.length > 0) {
		throw new ConfigurationError(summary, problems);
	}
}
