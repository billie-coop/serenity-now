import { describe, expect, test } from "vitest";
import { isBareSpecifier, packageNameFromSpecifier } from "./package_name.js";

describe("packageNameFromSpecifier", () => {
	test.each([
		["@scope/pkg", "@scope/pkg"],
		["@scope/pkg/sub/path", "@scope/pkg"],
		["pkg", "pkg"],
		["pkg/sub", "pkg"],
		["node:fs", "node:fs"],
	])("%s → %s", (specifier, expected) => {
		expect(packageNameFromSpecifier(specifier)).toBe(expected);
	});
});

describe("isBareSpecifier", () => {
	test.each([
		["react", true],
		["@scope/pkg", true],
		["./local", false],
		["../up", false],
		["/abs/path", false],
		["#internal", false],
		["", false],
	])("%s → %s", (specifier, expected) => {
		expect(isBareSpecifier(specifier)).toBe(expected);
	});
});
