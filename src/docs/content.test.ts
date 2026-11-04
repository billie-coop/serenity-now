import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { DOCS } from "./content.js";

test("npmPackage matches the published package name", () => {
	const pkg = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	);
	expect(DOCS.npmPackage).toBe(pkg.name);
});
