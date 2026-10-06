import { SymbolFlags } from "typescript/unstable/sync";
import type { ExportRecord } from "../../core/types.js";
import type { ConfigUnit } from "./session.js";

/**
 * Lists the exports of an entry point file, following re-exports to find out
 * whether each one is a type or a value.
 */
export function collectExports(
	unit: ConfigUnit,
	entryFile: string,
): ExportRecord[] {
	const { program, checker } = unit.project;
	const sourceFile = program.getSourceFile(entryFile);
	if (!sourceFile) return [];
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	if (!moduleSymbol) return [];

	return checker.getExportsOfModule(moduleSymbol).map((symbol) => {
		// getAliasedSymbol must only be called on aliases (the server panics otherwise).
		const target =
			symbol.flags & SymbolFlags.Alias
				? checker.getAliasedSymbol(symbol)
				: symbol;
		const flags = checker.isUnknownSymbol(target) ? symbol.flags : target.flags;
		const isModule =
			(flags & SymbolFlags.Module) !== 0 &&
			(flags & (SymbolFlags.Function | SymbolFlags.Class)) === 0;

		return {
			exportName: symbol.name,
			isTypeOnly:
				(flags & SymbolFlags.Type) !== 0 && (flags & SymbolFlags.Value) === 0,
			exportType:
				symbol.name === "default"
					? "default"
					: isModule
						? "namespace"
						: "named",
			// Declared in another file without an explicit export statement here: `export *`.
			isReExport: !symbol.declarations.some((d) => d.path === sourceFile.path),
		};
	});
}
