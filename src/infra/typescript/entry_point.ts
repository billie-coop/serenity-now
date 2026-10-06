import { existsSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { isJsonObject } from "../../core/json.js";
import type {
	EntryPointResolution,
	JsonValue,
	PackageJson,
	ProjectInfo,
} from "../../core/types.js";
import type { ConfigUnit } from "./session.js";

/** Conditions checked, in order, when "exports" maps "." to a conditions object. */
const EXPORT_CONDITIONS = ["types", "import", "default", "require"];

/** Build output extension → source extensions it may have been compiled from. */
const OUTPUT_TO_SOURCE: Array<[string, string[]]> = [
	[".d.ts", [".ts", ".tsx"]],
	[".d.mts", [".mts"]],
	[".d.cts", [".cts"]],
	[".js", [".ts", ".tsx", ".js", ".jsx"]],
	[".jsx", [".tsx", ".jsx"]],
	[".mjs", [".mts", ".mjs"]],
	[".cjs", [".cts", ".cjs"]],
];

const SOURCE_EXTENSIONS = [
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
];

/**
 * Finds the TypeScript source file behind a package's declared entry point.
 *
 * The entry point is what package.json declares: the "." export ("exports"
 * takes precedence, as in Node), otherwise "types"/"typings", otherwise
 * "module"/"main". If that path is build output inside a tsconfig's outDir,
 * it's mapped back to the source in that config's rootDir. A hand-written
 * declaration file (outside any outDir) is used as-is. Nothing else is
 * assumed: a package that declares no entry point is unresolved.
 */
export function resolveSourceEntryPoint(
	project: ProjectInfo,
	units: ConfigUnit[],
): EntryPointResolution {
	const declared = declaredEntryPoint(project.packageJson);
	if (!declared) {
		return {
			status: "unresolved",
			reason:
				'package.json declares no entry point ("exports", "types" or "main")',
		};
	}
	if ("error" in declared) {
		return { status: "unresolved", reason: declared.error };
	}

	const target = resolve(project.root, declared.path);
	const found = (path: string): EntryPointResolution => ({
		status: "resolved",
		path: relative(project.root, path).replaceAll("\\", "/"),
	});

	for (const unit of units) {
		if (!unit.outDir || !target.startsWith(unit.outDir + sep)) continue;
		const withoutDir = join(unit.rootDir, relative(unit.outDir, target));
		const [outputExt, sourceExts] =
			OUTPUT_TO_SOURCE.find(([ext]) => withoutDir.endsWith(ext)) ?? [];
		if (!outputExt || !sourceExts) continue;
		const base = withoutDir.slice(0, -outputExt.length);
		const source = sourceExts.map((ext) => base + ext).find(existsSync);
		if (source) return found(source);
		return {
			status: "unresolved",
			reason: `${declared.field} points to ${declared.path} (build output of ${unit.configPath}), but no matching source file exists under ${unit.rootDir}`,
		};
	}

	if (
		!isDeclarationFile(target) &&
		!SOURCE_EXTENSIONS.includes(extname(target))
	) {
		return {
			status: "unresolved",
			reason: `${declared.field} points to ${declared.path}, which is not a source file and is not inside any tsconfig outDir`,
		};
	}
	if (!existsSync(target)) {
		return {
			status: "unresolved",
			reason: `${declared.field} points to ${declared.path}, which does not exist`,
		};
	}
	return found(target);
}

type DeclaredEntryPoint = { field: string; path: string } | { error: string };

function declaredEntryPoint(pkg: PackageJson): DeclaredEntryPoint | undefined {
	if (pkg.exports !== undefined) {
		const path = pickExport(pkg.exports);
		return path
			? { field: '"exports"', path }
			: { error: '"exports" does not define a "." entry point' };
	}
	const types = pkg.types ?? pkg.typings;
	if (types) return { field: '"types"', path: types };
	const main = pkg.module ?? pkg.main;
	if (main) return { field: pkg.module ? '"module"' : '"main"', path: main };
	return undefined;
}

function pickExport(value: JsonValue): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const picked = pickExport(item);
			if (picked) return picked;
		}
		return undefined;
	}
	if (!isJsonObject(value)) return undefined;

	const keys = Object.keys(value);
	if (keys.some((k) => k.startsWith("."))) {
		const root = value["."];
		return root === undefined ? undefined : pickExport(root);
	}
	for (const condition of EXPORT_CONDITIONS) {
		const nested = value[condition];
		if (nested !== undefined) {
			const picked = pickExport(nested);
			if (picked) return picked;
		}
	}
	return undefined;
}

function isDeclarationFile(path: string): boolean {
	return /\.d\.[cm]?ts$/.test(path);
}
