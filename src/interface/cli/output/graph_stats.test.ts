import { describe, expect, test } from "vitest";
import type { DiamondPattern } from "../../../core/types.js";
import {
	makeGraph,
	makeInventory,
	makeProject,
} from "../../../test_support/builders.js";
import {
	actionableDiamonds,
	dependents,
	listWithMore,
	universalDiamondCounts,
} from "./graph_stats.js";

const inventory = makeInventory(
	["a", "b", "c", "d"].map((id) => makeProject(id)),
);
const diamond = (
	projectId: string,
	directDependency: string,
	pattern: DiamondPattern["pattern"] = "incomplete-abstraction",
): DiamondPattern => ({
	projectId,
	directDependency,
	transitiveThrough: ["x"],
	pattern,
});

describe("dependents", () => {
	test("lists the projects that depend on each package, including unused ones", () => {
		const graph = makeGraph(inventory, { a: ["b", "c"], b: ["c"] });
		expect(Object.fromEntries(dependents(graph))).toEqual({
			a: [],
			b: ["a"],
			c: ["a", "b"],
			d: [],
		});
	});
});

describe("actionableDiamonds", () => {
	test("groups incomplete-abstraction diamonds by package, most frequent first", () => {
		const graph = makeGraph(
			inventory,
			{},
			{
				diamonds: [
					diamond("a", "c"),
					diamond("a", "d"),
					diamond("b", "d"),
					diamond("b", "c", "universal-utility"),
				],
			},
		);
		expect(
			actionableDiamonds(graph).map(([pkg, list]) => [pkg, list.length]),
		).toEqual([
			["d", 2],
			["c", 1],
		]);
	});
});

describe("universalDiamondCounts", () => {
	test("counts universal-utility diamonds per package", () => {
		const graph = makeGraph(
			inventory,
			{},
			{
				diamonds: [
					diamond("a", "u", "universal-utility"),
					diamond("b", "u", "universal-utility"),
					diamond("a", "c"),
				],
			},
		);
		expect(universalDiamondCounts(graph)).toEqual([["u", 2]]);
	});
});

describe("listWithMore", () => {
	test("truncates long lists", () => {
		expect(listWithMore(["a", "b"], 3)).toBe("a, b");
		expect(listWithMore(["a", "b", "c", "d"], 2)).toBe("a, b, … (+2)");
	});
});
