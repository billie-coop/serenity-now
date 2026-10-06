import { describe, expect, test } from "vitest";
import { deepMerge, isJsonObject, jsonEqual } from "./json.js";

describe("isJsonObject", () => {
	test("only plain objects", () => {
		expect(isJsonObject({})).toBe(true);
		expect(isJsonObject([])).toBe(false);
		expect(isJsonObject(null)).toBe(false);
		expect(isJsonObject("x")).toBe(false);
	});
});

describe("jsonEqual", () => {
	test("compares deeply, ignoring key order", () => {
		expect(
			jsonEqual({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] }),
		).toBe(true);
	});

	test("detects differences", () => {
		expect(jsonEqual([1, 2], [2, 1])).toBe(false);
		expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(jsonEqual({ a: 1 }, { b: 1 })).toBe(false);
		expect(jsonEqual(undefined, {})).toBe(false);
		expect(jsonEqual("1", 1)).toBe(false);
	});
});

describe("deepMerge", () => {
	test("merges objects recursively and replaces everything else", () => {
		const target = { a: { b: 1, c: [1, 2] }, d: "x" };
		const merged = deepMerge(target, { a: { c: [3], e: true }, d: "y" });
		expect(merged).toEqual({ a: { b: 1, c: [3], e: true }, d: "y" });
		expect(target).toEqual({ a: { b: 1, c: [1, 2] }, d: "x" });
	});
});
