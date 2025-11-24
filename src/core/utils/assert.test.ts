import { describe, expect, it } from "vitest";
import { assert } from "./assert.js";

describe("assert", () => {
	it("narrows truthy values and throws otherwise", () => {
		expect(() => assert(false, () => new Error("fail"))).toThrow("fail");

		const value: number | null = 42;
		assert(value);
		// if the code reaches here, narrowing worked

		assert(true);

		const customMessage = () => new Error("custom");
		expect(() => assert(null, customMessage)).toThrow("custom");
	});

	it("throws on null with default message", () => {
		expect(() => assert(null)).toThrow("Assertion failed");
	});

	it("throws on undefined with default message", () => {
		expect(() => assert(undefined)).toThrow("Assertion failed");
	});

	it("throws Error object directly", () => {
		const customError = new Error("direct error");
		expect(() => assert(false, customError)).toThrow(customError);
	});
});
