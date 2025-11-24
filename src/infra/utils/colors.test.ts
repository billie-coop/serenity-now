import { describe, expect, it } from "vitest";
import { bold, cyan, green, red, yellow } from "./colors.js";

describe("colors", () => {
	it("wraps text in bold ANSI codes", () => {
		const result = bold("test");
		expect(result).toContain("test");
		expect(result).toContain("\x1b[1m");
		expect(result).toContain("\x1b[0m");
	});

	it("wraps text in red ANSI codes", () => {
		const result = red("error");
		expect(result).toContain("error");
		expect(result).toContain("\x1b[31m");
		expect(result).toContain("\x1b[0m");
	});

	it("wraps text in green ANSI codes", () => {
		const result = green("success");
		expect(result).toContain("success");
		expect(result).toContain("\x1b[32m");
		expect(result).toContain("\x1b[0m");
	});

	it("wraps text in yellow ANSI codes", () => {
		const result = yellow("warning");
		expect(result).toContain("warning");
		expect(result).toContain("\x1b[33m");
		expect(result).toContain("\x1b[0m");
	});

	it("wraps text in cyan ANSI codes", () => {
		const result = cyan("info");
		expect(result).toContain("info");
		expect(result).toContain("\x1b[36m");
		expect(result).toContain("\x1b[0m");
	});
});
