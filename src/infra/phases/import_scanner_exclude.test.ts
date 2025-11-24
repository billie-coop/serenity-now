import { describe, expect, it } from "vitest";
import { globToRegExp } from "../../infra/utils/glob.js";

function shouldExclude(path: string, pattern: string): boolean {
	const normalizedPath = path.replace(/\\/g, "/");
	const regex = globToRegExp(pattern);
	return regex.test(normalizedPath);
}

describe("exclude pattern", () => {
	it("**/node_modules/** should match node_modules at any level", () => {
		const pattern = "**/node_modules/**";

		expect(shouldExclude("node_modules/foo/index.js", pattern)).toBe(true);
		expect(shouldExclude("src/node_modules/bar/main.js", pattern)).toBe(true);
		expect(shouldExclude("packages/app/node_modules/lib.js", pattern)).toBe(
			true,
		);

		expect(shouldExclude("node_modules-helper/src/index.js", pattern)).toBe(
			false,
		);
		expect(shouldExclude("packages/node_modules_backup/file.js", pattern)).toBe(
			false,
		);
		expect(shouldExclude("src/my-node_modules/test.js", pattern)).toBe(false);
	});

	it("**/dist/** should match dist directory, not substring", () => {
		const pattern = "**/dist/**";

		expect(shouldExclude("dist/index.js", pattern)).toBe(true);
		expect(shouldExclude("packages/app/dist/bundle.js", pattern)).toBe(true);

		expect(shouldExclude("packages/distribution/src/index.js", pattern)).toBe(
			false,
		);
		expect(shouldExclude("src/distant/file.js", pattern)).toBe(false);
		expect(shouldExclude("redis_toolkit/main.js", pattern)).toBe(false);
	});

	it("**/*.test.ts should match test files at any level", () => {
		const pattern = "**/*.test.ts";

		expect(shouldExclude("foo.test.ts", pattern)).toBe(true);
		expect(shouldExclude("src/utils/helper.test.ts", pattern)).toBe(true);
		expect(
			shouldExclude("packages/app/__tests__/button.test.ts", pattern),
		).toBe(true);

		expect(shouldExclude("src/test.ts", pattern)).toBe(false);
		expect(shouldExclude("foo.test.tsx", pattern)).toBe(false);
	});

	it("**/__tests__/** should match __tests__ directory only", () => {
		const pattern = "**/__tests__/**";

		expect(shouldExclude("__tests__/foo.ts", pattern)).toBe(true);
		expect(shouldExclude("src/__tests__/bar.test.ts", pattern)).toBe(true);

		expect(shouldExclude("src/__tests_helpers__/util.ts", pattern)).toBe(false);
		expect(shouldExclude("my__tests__/file.ts", pattern)).toBe(false);
	});
});
