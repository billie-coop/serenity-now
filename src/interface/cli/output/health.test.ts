import { describe, expect, test } from "vitest";
import type { DiamondPattern } from "../../../core/types.js";
import {
	makeGraph,
	makeInventory,
	makeProject,
} from "../../../test_support/builders.js";
import { formatHealthReport } from "./health.js";

const inventory = makeInventory([
	makeProject("app", { relativeRoot: "apps/app", workspaceType: "app" }),
	makeProject("ui"),
	makeProject("utils"),
	makeProject("orphan"),
]);

describe("formatHealthReport", () => {
	test("a healthy repo", () => {
		const graph = makeGraph(inventory, { app: ["ui", "utils", "orphan"] });
		const text = formatHealthReport(graph).join("\n");
		expect(text).toContain("✓ No circular dependencies");
		expect(text).toContain("✓ No diamond dependencies");
		expect(text).toContain("✓ Every shared package is used");
		expect(text).toContain("Most depended-upon packages:");
		expect(text).not.toContain("Not scanned");
	});

	test("reports cycles, diamonds, unused packages and unscanned projects", () => {
		const diamonds: DiamondPattern[] = [
			{
				projectId: "app",
				directDependency: "utils",
				transitiveThrough: ["ui"],
				pattern: "incomplete-abstraction",
			},
			{
				projectId: "app",
				directDependency: "ui",
				transitiveThrough: ["x"],
				pattern: "universal-utility",
			},
		];
		const graph = makeGraph(
			inventory,
			{ app: ["ui", "utils"], ui: ["utils"] },
			{
				cycles: [{ path: ["ui", "utils", "ui"] }],
				diamonds,
			},
		);
		const unscanned = graph.projects.orphan;
		if (unscanned) unscanned.scanned = false;

		const lines = formatHealthReport(graph);
		expect(lines).toContain("Circular dependencies (1):");
		expect(lines).toContain("  - ui → utils → ui");
		expect(lines).toContain(
			"Diamond dependencies (1, excluding universal utilities):",
		);
		expect(lines).toContain("    - app: direct and via ui");
		expect(lines).toContain("  ui: 1 (universal utility, expected)");
		expect(lines).toContain(
			"Shared packages no project depends on (1): orphan",
		);
		expect(lines).toContain("Not scanned (left untouched by sync): orphan");
	});
});
