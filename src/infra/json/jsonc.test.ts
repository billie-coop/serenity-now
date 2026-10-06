import { describe, expect, test } from "vitest";
import { ConfigurationError } from "../../core/errors.js";
import { applyJsonEdits, parseJsonc } from "./jsonc.js";

describe("parseJsonc", () => {
	test("accepts comments and trailing commas", () => {
		const text =
			'{\n\t// comment\n\t"a": [1, 2,], /* block */\n\t"b": true,\n}';
		expect(parseJsonc(text, "x.json")).toEqual({ a: [1, 2], b: true });
	});

	test("reports the first syntax error as file:line:col", () => {
		const text = '{\n  "a": 1,\n  "b": tru\n}';
		let error: unknown;
		try {
			parseJsonc(text, "/repo/tsconfig.json");
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(ConfigurationError);
		expect((error as Error).message).toMatch(
			/^\/repo\/tsconfig\.json:3:8: invalid JSON \(InvalidSymbol\)$/,
		);
	});
});

describe("applyJsonEdits", () => {
	test("preserves comments and unrelated formatting", () => {
		const text =
			'{\n\t// keep me\n\t"name": "x", // trailing\n\t"version": "1.0.0"\n}\n';
		const result = applyJsonEdits(text, [
			{ path: ["version"], value: "2.0.0" },
		]);
		expect(result).toBe(
			'{\n\t// keep me\n\t"name": "x", // trailing\n\t"version": "2.0.0"\n}\n',
		);
	});

	test("uses tabs when the file uses tabs", () => {
		const text = '{\n\t"name": "x"\n}\n';
		const result = applyJsonEdits(text, [
			{ path: ["dependencies", "a"], value: "1" },
		]);
		expect(result).toBe(
			'{\n\t"name": "x",\n\t"dependencies": {\n\t\t"a": "1"\n\t}\n}\n',
		);
	});

	test("uses the file's space indentation", () => {
		const text = '{\n    "name": "x"\n}\n';
		const result = applyJsonEdits(text, [
			{ path: ["dependencies", "a"], value: "1" },
		]);
		expect(result).toBe(
			'{\n    "name": "x",\n    "dependencies": {\n        "a": "1"\n    }\n}\n',
		);
	});

	test("keeps CRLF line endings", () => {
		const text = '{\r\n  "name": "x"\r\n}\r\n';
		const result = applyJsonEdits(text, [{ path: ["private"], value: true }]);
		expect(result).toBe('{\r\n  "name": "x",\r\n  "private": true\r\n}\r\n');
	});

	test("sorted insertion places new keys alphabetically", () => {
		const text =
			'{\n\t"dependencies": {\n\t\t"a": "1",\n\t\t"c": "1"\n\t}\n}\n';
		const result = applyJsonEdits(text, [
			{ path: ["dependencies", "b"], value: "2", sortedInsert: true },
			{ path: ["dependencies", "d"], value: "2", sortedInsert: true },
		]);
		expect(result).toBe(
			'{\n\t"dependencies": {\n\t\t"a": "1",\n\t\t"b": "2",\n\t\t"c": "1",\n\t\t"d": "2"\n\t}\n}\n',
		);
	});

	test("creates missing parent objects at the end, not sorted against the child key", () => {
		const text = '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n';
		const result = applyJsonEdits(text, [
			{
				path: ["compilerOptions", "paths", "@x/ui"],
				value: ["../ui/src/index.ts"],
				sortedInsert: true,
			},
		]);
		expect(JSON.parse(result)).toEqual({
			compilerOptions: {
				strict: true,
				paths: { "@x/ui": ["../ui/src/index.ts"] },
			},
		});
		expect(result.indexOf('"strict"')).toBeLessThan(result.indexOf('"paths"'));
	});

	test("creates several missing levels", () => {
		const result = applyJsonEdits("{}", [
			{
				path: ["compilerOptions", "paths", "x"],
				value: ["y"],
				sortedInsert: true,
			},
		]);
		expect(JSON.parse(result)).toEqual({
			compilerOptions: { paths: { x: ["y"] } },
		});
	});

	test("leaves neighbouring entries byte-for-byte unchanged", () => {
		const text =
			'{\n  "paths": {\n    "a": ["x"],\n    "b": ["y"],\n    "c": ["z"]\n  }\n}\n';
		expect(
			applyJsonEdits(text, [{ path: ["paths", "b"], value: undefined }]),
		).toBe('{\n  "paths": {\n    "a": ["x"],\n    "c": ["z"]\n  }\n}\n');
		const inserted = applyJsonEdits(text, [
			{ path: ["paths", "bb"], value: ["q"], sortedInsert: true },
		]);
		expect(inserted).toContain('    "a": ["x"],\n    "b": ["y"],\n    "bb": [');
		expect(inserted).toContain('    "c": ["z"]\n');
		const first = applyJsonEdits(text, [
			{ path: ["paths", "0"], value: ["q"], sortedInsert: true },
		]);
		expect(first).toMatch(/^\{\n {2}"paths": \{\n {4}"0": \[/);
	});

	test("removes properties", () => {
		const text =
			'{\n\t"dependencies": {\n\t\t"a": "1",\n\t\t"b": "1"\n\t}\n}\n';
		const result = applyJsonEdits(text, [
			{ path: ["dependencies", "a"], value: undefined },
		]);
		expect(result).toBe('{\n\t"dependencies": {\n\t\t"b": "1"\n\t}\n}\n');
	});

	test("removing a missing key of an existing object is a no-op", () => {
		const text = '{\n\t"a": {\n\t\t"b": 1\n\t}\n}\n';
		expect(applyJsonEdits(text, [{ path: ["a", "c"], value: undefined }])).toBe(
			text,
		);
	});

	test("replaces arrays", () => {
		const text = '{\n  "references": [{ "path": "../a" }]\n}\n';
		const result = applyJsonEdits(text, [
			{ path: ["references"], value: [{ path: "../b" }] },
		]);
		expect(JSON.parse(result)).toEqual({ references: [{ path: "../b" }] });
	});
});
