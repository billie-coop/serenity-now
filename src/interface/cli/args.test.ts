import { describe, expect, test } from "vitest";
import { parseCliArgs, UsageError } from "./args.js";

describe("parseCliArgs", () => {
	test("defaults to sync with every flag off", () => {
		expect(parseCliArgs([])).toEqual({
			command: "sync",
			help: false,
			dryRun: false,
			check: false,
			force: false,
			verbose: false,
			config: undefined,
		});
	});

	test("accepts each command", () => {
		for (const command of [
			"sync",
			"health",
			"detect-unused-exports",
			"generate-report",
		]) {
			expect(parseCliArgs([command]).command).toBe(command);
		}
	});

	test("long and short flags", () => {
		expect(
			parseCliArgs(["--dry-run", "--force", "--verbose", "--check"]),
		).toMatchObject({
			dryRun: true,
			force: true,
			verbose: true,
			check: true,
		});
		expect(parseCliArgs(["-d", "-f", "-v", "-h"])).toMatchObject({
			dryRun: true,
			force: true,
			verbose: true,
			help: true,
		});
	});

	test("--config takes a value", () => {
		expect(parseCliArgs(["--config", "custom.jsonc"]).config).toBe(
			"custom.jsonc",
		);
		expect(parseCliArgs(["-c", "other.jsonc"]).config).toBe("other.jsonc");
		expect(parseCliArgs(["--config=x.jsonc"]).config).toBe("x.jsonc");
	});

	test("flags may come before the command", () => {
		expect(parseCliArgs(["-v", "health"])).toMatchObject({
			command: "health",
			verbose: true,
		});
	});

	test("rejects unknown commands", () => {
		expect(() => parseCliArgs(["bogus"])).toThrow(UsageError);
		expect(() => parseCliArgs(["bogus"])).toThrow(/Unknown command "bogus"/);
	});

	test("rejects unknown options", () => {
		expect(() => parseCliArgs(["--fail-on-stale"])).toThrow(UsageError);
		expect(() => parseCliArgs(["--health"])).toThrow(UsageError);
	});

	test("rejects more than one command", () => {
		expect(() => parseCliArgs(["sync", "health"])).toThrow(
			/Expected one command/,
		);
	});

	test("rejects a missing --config value", () => {
		expect(() => parseCliArgs(["--config"])).toThrow(UsageError);
	});

	test("rejects sync-only flags for other commands", () => {
		expect(() => parseCliArgs(["health", "--dry-run"])).toThrow(
			"--dry-run only applies to the sync command",
		);
		expect(() =>
			parseCliArgs(["detect-unused-exports", "--check", "--force"]),
		).toThrow("--check, --force only applies to the sync command");
		expect(parseCliArgs(["health", "--verbose", "-c", "x"]).verbose).toBe(true);
	});
});
