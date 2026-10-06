import { describe, expect, test } from "vitest";
import {
	makeAnalysis,
	makeConfig,
	makeImport,
	makeInventory,
	makeProject,
} from "../test_support/builders.js";
import { ConfigurationError } from "./errors.js";
import { resolveGraph } from "./graph.js";

const deps = (graph: ReturnType<typeof resolveGraph>, id: string) =>
	Object.keys(graph.projects[id]?.dependencies ?? {}).sort();

describe("resolveGraph", () => {
	test("builds dependencies from imports with entry points and source files", () => {
		const inventory = makeInventory([
			makeProject("app", { relativeRoot: "apps/app", workspaceType: "app" }),
			makeProject("@x/ui"),
		]);
		const analysis = makeAnalysis(inventory, {
			app: [
				makeImport("@x/ui", { sourceFile: "src/a.ts" }),
				makeImport("@x/ui", { sourceFile: "src/b.ts" }),
				makeImport("@x/ui", { sourceFile: "src/a.ts" }),
			],
		});
		analysis.entryPoints["@x/ui"] = { status: "resolved", path: "lib/main.ts" };

		const graph = resolveGraph(inventory, analysis, makeConfig());

		const dep = graph.projects.app?.dependencies["@x/ui"];
		expect(dep?.reason).toBe("import");
		expect(dep?.entryPoint).toBe("lib/main.ts");
		expect(dep?.sourceFiles).toEqual(["src/a.ts", "src/b.ts"]);
		expect(dep?.dependency.id).toBe("@x/ui");
		expect(graph.projects.app?.scanned).toBe(true);
	});

	test("adds defaultDependencies to every project except itself", () => {
		const inventory = makeInventory([
			makeProject("a"),
			makeProject("b"),
			makeProject("utils"),
		]);
		const graph = resolveGraph(
			inventory,
			makeAnalysis(inventory, { a: ["b"] }),
			makeConfig({ defaultDependencies: ["utils"] }),
		);

		expect(deps(graph, "a")).toEqual(["b", "utils"]);
		expect(deps(graph, "b")).toEqual(["utils"]);
		expect(deps(graph, "utils")).toEqual([]);
		expect(graph.projects.b?.dependencies.utils?.reason).toBe("default");
		expect(graph.projects.b?.dependencies.utils?.sourceFiles).toEqual([]);
	});

	test("an import that is also a default dependency keeps the import reason", () => {
		const inventory = makeInventory([makeProject("a"), makeProject("utils")]);
		const graph = resolveGraph(
			inventory,
			makeAnalysis(inventory, { a: ["utils"] }),
			makeConfig({ defaultDependencies: ["utils"] }),
		);
		expect(graph.projects.a?.dependencies.utils?.reason).toBe("import");
	});

	test("skips self-imports", () => {
		const inventory = makeInventory([makeProject("a")]);
		const graph = resolveGraph(
			inventory,
			makeAnalysis(inventory, { a: ["a"] }),
			makeConfig(),
		);
		expect(deps(graph, "a")).toEqual([]);
		expect(graph.cycles).toEqual([]);
	});

	test("unscanned projects are marked and get no dependencies", () => {
		const inventory = makeInventory([makeProject("a"), makeProject("b")]);
		const analysis = makeAnalysis(
			inventory,
			{},
			{
				projects: { a: { status: "skipped", reason: "no tsconfig.json" } },
			},
		);
		const graph = resolveGraph(
			inventory,
			analysis,
			makeConfig({ defaultDependencies: ["b"] }),
		);
		expect(graph.projects.a?.scanned).toBe(false);
		expect(deps(graph, "a")).toEqual([]);
		expect(graph.projects.b?.scanned).toBe(true);
	});

	test("throws listing every used dependency whose entry point is unresolved", () => {
		const inventory = makeInventory([
			makeProject("a"),
			makeProject("b"),
			makeProject("c"),
			makeProject("unused"),
		]);
		const analysis = makeAnalysis(
			inventory,
			{ a: ["b", "c"] },
			{
				entryPoints: {
					b: { status: "unresolved", reason: "no exports" },
					c: { status: "unresolved", reason: "missing file" },
					unused: { status: "unresolved", reason: "irrelevant" },
				},
			},
		);

		let error: unknown;
		try {
			resolveGraph(inventory, analysis, makeConfig());
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(ConfigurationError);
		const problems = (error as ConfigurationError).problems;
		expect(problems).toEqual(["b: no exports", "c: missing file"]);
	});

	test("throws when a dependency with a tsconfig is not composite", () => {
		const inventory = makeInventory([makeProject("a"), makeProject("b")]);
		const analysis = makeAnalysis(
			inventory,
			{ a: ["b"] },
			{ composite: { b: false } },
		);
		let error: unknown;
		try {
			resolveGraph(inventory, analysis, makeConfig());
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(ConfigurationError);
		expect((error as Error).message).toContain(
			"Cannot reference these workspace dependencies",
		);
		expect((error as ConfigurationError).problems).toHaveLength(1);
		expect((error as ConfigurationError).problems[0]).toMatch(/^b: /);
		expect((error as ConfigurationError).problems[0]).toMatch(/composite/);
	});

	test("reports unresolved entry points and non-composite dependencies together", () => {
		const inventory = makeInventory([
			makeProject("a"),
			makeProject("b"),
			makeProject("c"),
		]);
		const analysis = makeAnalysis(
			inventory,
			{ a: ["b", "c"] },
			{
				entryPoints: { b: { status: "unresolved", reason: "no exports" } },
				composite: { c: false },
			},
		);
		let error: unknown;
		try {
			resolveGraph(inventory, analysis, makeConfig());
		} catch (e) {
			error = e;
		}
		const problems = (error as ConfigurationError).problems;
		expect(problems).toHaveLength(2);
		expect(problems.some((p) => p === "b: no exports")).toBe(true);
		expect(problems.some((p) => p.startsWith("c: "))).toBe(true);
	});

	test("non-composite projects nobody depends on are fine", () => {
		const inventory = makeInventory([makeProject("a"), makeProject("b")]);
		const analysis = makeAnalysis(inventory, {}, { composite: { b: false } });
		expect(() => resolveGraph(inventory, analysis, makeConfig())).not.toThrow();
	});

	test("a dependency without a tsconfig (requiresTsconfig false) is allowed", () => {
		const inventory = makeInventory([
			makeProject("a"),
			makeProject("js", {
				tsconfigPath: undefined,
				workspaceConfig: { requiresTsconfig: false },
			}),
		]);
		const analysis = makeAnalysis(
			inventory,
			{ a: ["js"] },
			{ composite: { js: false } },
		);
		const graph = resolveGraph(inventory, analysis, makeConfig());
		expect(deps(graph, "a")).toEqual(["js"]);
	});

	test("unresolved entry points of unused packages are fine", () => {
		const inventory = makeInventory([makeProject("a"), makeProject("b")]);
		const analysis = makeAnalysis(
			inventory,
			{},
			{ entryPoints: { b: { status: "unresolved", reason: "none" } } },
		);
		expect(() => resolveGraph(inventory, analysis, makeConfig())).not.toThrow();
	});

	test("throws when a defaultDependency is not a workspace package", () => {
		const inventory = makeInventory([makeProject("a")]);
		expect(() =>
			resolveGraph(
				inventory,
				makeAnalysis(inventory),
				makeConfig({ defaultDependencies: ["lodash"] }),
			),
		).toThrow(/defaultDependencies contains "lodash"/);
	});

	test("ignores imports of packages that aren't in the inventory", () => {
		const inventory = makeInventory([makeProject("a")]);
		const graph = resolveGraph(
			inventory,
			makeAnalysis(inventory, { a: ["ghost"] }),
			makeConfig(),
		);
		expect(deps(graph, "a")).toEqual([]);
	});

	describe("cycles", () => {
		test("detects each cycle once", () => {
			const inventory = makeInventory([
				makeProject("a"),
				makeProject("b"),
				makeProject("c"),
				makeProject("d"),
			]);
			const graph = resolveGraph(
				inventory,
				makeAnalysis(inventory, { a: ["b"], b: ["c"], c: ["a"], d: ["a"] }),
				makeConfig(),
			);
			expect(graph.cycles).toEqual([{ path: ["a", "b", "c", "a"] }]);
		});

		test("detects separate cycles", () => {
			const inventory = makeInventory([
				makeProject("a"),
				makeProject("b"),
				makeProject("x"),
				makeProject("y"),
			]);
			const graph = resolveGraph(
				inventory,
				makeAnalysis(inventory, { a: ["b"], b: ["a"], x: ["y"], y: ["x"] }),
				makeConfig(),
			);
			expect(graph.cycles).toEqual([
				{ path: ["a", "b", "a"] },
				{ path: ["x", "y", "x"] },
			]);
		});

		test("no cycles in a DAG", () => {
			const inventory = makeInventory([
				makeProject("a"),
				makeProject("b"),
				makeProject("c"),
			]);
			const graph = resolveGraph(
				inventory,
				makeAnalysis(inventory, { a: ["b", "c"], b: ["c"] }),
				makeConfig(),
			);
			expect(graph.cycles).toEqual([]);
		});
	});

	describe("diamonds", () => {
		test("a direct dependency also reached through another direct dependency", () => {
			const inventory = makeInventory([
				makeProject("top"),
				makeProject("mid"),
				makeProject("base"),
			]);
			const graph = resolveGraph(
				inventory,
				makeAnalysis(inventory, { top: ["mid", "base"], mid: ["base"] }),
				makeConfig(),
			);
			expect(graph.diamonds).toEqual([
				{
					projectId: "top",
					directDependency: "base",
					transitiveThrough: ["mid"],
					pattern: "incomplete-abstraction",
				},
			]);
		});

		test("transitiveThrough lists every direct dependency reaching it through deeper chains", () => {
			// top → a → x → base, top → b → x → base, top → base
			const inventory = makeInventory([
				makeProject("top"),
				makeProject("a"),
				makeProject("b"),
				makeProject("x"),
				makeProject("base"),
			]);
			const graph = resolveGraph(
				inventory,
				makeAnalysis(inventory, {
					top: ["a", "b", "base"],
					a: ["x"],
					b: ["x"],
					x: ["base"],
				}),
				makeConfig(),
			);
			const diamond = graph.diamonds.find(
				(d) => d.projectId === "top" && d.directDependency === "base",
			);
			expect(diamond?.transitiveThrough).toEqual(["a", "b"]);
		});

		test("universalUtilities and defaultDependencies are classified as universal", () => {
			const inventory = makeInventory([
				makeProject("top"),
				makeProject("mid"),
				makeProject("logger"),
				makeProject("utils"),
			]);
			const graph = resolveGraph(
				inventory,
				makeAnalysis(inventory, {
					top: ["mid", "logger"],
					mid: ["logger"],
				}),
				makeConfig({
					universalUtilities: ["logger"],
					defaultDependencies: ["utils"],
				}),
			);
			const patterns = Object.fromEntries(
				graph.diamonds
					.filter((d) => d.projectId === "top")
					.map((d) => [d.directDependency, d.pattern]),
			);
			expect(patterns).toEqual({
				logger: "universal-utility",
				utils: "universal-utility",
			});
		});
	});
});
