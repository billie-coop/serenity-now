import { describe, expect, it } from "vitest";
import { parseArgs } from "./parseArgs.js";

describe("parseArgs", () => {
	it("parses positional arguments", () => {
		const result = parseArgs(["foo", "bar", "baz"]);
		expect(result._).toEqual(["foo", "bar", "baz"]);
	});

	it("parses boolean flags with --", () => {
		const result = parseArgs(["--verbose", "--debug"], {
			boolean: ["verbose", "debug"],
		});
		expect(result.verbose).toBe(true);
		expect(result.debug).toBe(true);
	});

	it("parses string options with --", () => {
		const result = parseArgs(["--config", "foo.json", "--output", "bar.txt"], {
			string: ["config", "output"],
		});
		expect(result.config).toBe("foo.json");
		expect(result.output).toBe("bar.txt");
	});

	it("parses --flag=value syntax", () => {
		const result = parseArgs(["--name=john", "--age=30"]);
		expect(result.name).toBe("john");
		expect(result.age).toBe("30");
	});

	it("parses single character flags with -", () => {
		const result = parseArgs(["-v", "-d"], {
			boolean: ["v", "d"],
		});
		expect(result.v).toBe(true);
		expect(result.d).toBe(true);
	});

	it("parses combined short flags", () => {
		const result = parseArgs(["-vdf"], {
			boolean: ["v", "d", "f"],
		});
		expect(result.v).toBe(true);
		expect(result.d).toBe(true);
		expect(result.f).toBe(true);
	});

	it("parses short string option with value", () => {
		const result = parseArgs(["-c", "config.json"], {
			string: ["c"],
		});
		expect(result.c).toBe("config.json");
	});

	it("handles aliases", () => {
		const result = parseArgs(["-v", "--help"], {
			alias: {
				v: "verbose",
				h: "help",
			},
		});
		expect(result.verbose).toBe(true);
		expect(result.help).toBe(true);
	});

	it("handles multiple aliases for same option", () => {
		const result = parseArgs(["-v"], {
			alias: {
				v: ["verbose", "debug"],
			},
		});
		// When array of aliases, last one wins due to Map.set overwriting
		expect(result.debug).toBe(true);
		expect(result.v).toBeUndefined();
	});

	it("handles mixed positional and flag arguments", () => {
		const result = parseArgs(["build", "--watch", "src"], {
			boolean: ["watch"],
		});
		expect(result._).toEqual(["build", "src"]);
		expect(result.watch).toBe(true);
	});

	it("handles empty string value for string option", () => {
		const result = parseArgs(["--name"], {
			string: ["name"],
		});
		expect(result.name).toBe("");
	});

	it("defaults to boolean true for unknown flags", () => {
		const result = parseArgs(["--unknown"]);
		expect(result.unknown).toBe(true);
	});

	it("handles boolean flag with equals syntax", () => {
		const result = parseArgs(["--watch=true"], {
			boolean: ["watch"],
		});
		expect(result.watch).toBe("true");
	});

	it("skips empty/undefined args", () => {
		const result = parseArgs(["", "foo", "", "bar"]);
		expect(result._).toEqual(["foo", "bar"]);
	});

	it("handles single char string option without value", () => {
		const result = parseArgs(["-c"], {
			string: ["c"],
		});
		// When no next arg exists, it's treated as boolean
		expect(result.c).toBe(true);
	});

	it("handles combined flags where one is a string option", () => {
		const result = parseArgs(["-vdc", "config.json"], {
			boolean: ["v", "d"],
			string: ["c"],
		});
		// Combined flags are all treated as booleans
		expect(result.v).toBe(true);
		expect(result.d).toBe(true);
		expect(result.c).toBe(true);
		expect(result._).toEqual(["config.json"]);
	});

	it("treats value starting with - as flag not value", () => {
		const result = parseArgs(["-c", "-v"], {
			string: ["c"],
			boolean: ["v"],
		});
		// When next arg starts with -, string option becomes boolean
		expect(result.c).toBe(true);
		expect(result.v).toBe(true);
	});

	it("handles alias with long form in arguments", () => {
		const result = parseArgs(["--verbose"], {
			alias: {
				v: "verbose",
			},
		});
		expect(result.verbose).toBe(true);
	});

	it("handles empty args array", () => {
		const result = parseArgs([]);
		expect(result._).toEqual([]);
	});

	it("handles no options provided", () => {
		const result = parseArgs(["foo", "--bar"]);
		expect(result._).toEqual(["foo"]);
		expect(result.bar).toBe(true);
	});
});
