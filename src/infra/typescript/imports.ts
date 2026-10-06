import {
	type EntityName,
	isCallExpression,
	isExportDeclaration,
	isExternalModuleReference,
	isIdentifier,
	isImportDeclaration,
	isImportEqualsDeclaration,
	isImportTypeNode,
	isLiteralTypeNode,
	isNamedExports,
	isNamedImports,
	isNamespaceImport,
	isStringLiteral,
	type Node,
	type SourceFile,
	SyntaxKind,
} from "typescript/unstable/ast";
import type { ImportedBindings } from "../../core/types.js";

export interface ModuleImport {
	specifier: string;
	isTypeOnly: boolean;
	bindings: ImportedBindings;
}

const NAMESPACE: ImportedBindings = { kind: "namespace" };

/**
 * Every module a source file imports: import/export declarations,
 * `import x = require()`, dynamic `import()`, `require()` and
 * `typeof import()` types.
 */
export function collectModuleImports(sourceFile: SourceFile): ModuleImport[] {
	const literals = [...sourceFile.imports];
	// The compiler only records require() calls for JavaScript files.
	if (sourceFile.text.includes("require(")) {
		const seen = new Set(literals);
		forEachRequireCall(sourceFile, (literal) => {
			if (!seen.has(literal)) literals.push(literal);
		});
	}
	return literals.flatMap((literal) =>
		isStringLiteral(literal)
			? [describeImport(literal.text, literal.parent)]
			: [],
	);
}

function describeImport(specifier: string, parent: Node): ModuleImport {
	if (isImportDeclaration(parent)) {
		const clause = parent.importClause;
		if (!clause) {
			return {
				specifier,
				isTypeOnly: false,
				bindings: { kind: "side-effect" },
			};
		}
		const bindings = clause.namedBindings;
		const elements =
			bindings && isNamedImports(bindings) ? bindings.elements : [];
		const isTypeOnly =
			clause.phaseModifier === SyntaxKind.TypeKeyword ||
			(!clause.name &&
				elements.length > 0 &&
				elements.every((e) => e.isTypeOnly));
		if (bindings && isNamespaceImport(bindings)) {
			return { specifier, isTypeOnly, bindings: NAMESPACE };
		}
		const names = elements.map((e) => (e.propertyName ?? e.name).text);
		if (clause.name) names.unshift("default");
		return { specifier, isTypeOnly, bindings: { kind: "named", names } };
	}

	if (isExportDeclaration(parent)) {
		const clause = parent.exportClause;
		if (!clause || !isNamedExports(clause)) {
			// export * from / export * as ns from
			return { specifier, isTypeOnly: parent.isTypeOnly, bindings: NAMESPACE };
		}
		return {
			specifier,
			isTypeOnly:
				parent.isTypeOnly ||
				(clause.elements.length > 0 &&
					clause.elements.every((e) => e.isTypeOnly)),
			bindings: {
				kind: "named",
				names: clause.elements.map((e) => (e.propertyName ?? e.name).text),
			},
		};
	}

	if (
		isExternalModuleReference(parent) &&
		isImportEqualsDeclaration(parent.parent)
	) {
		return {
			specifier,
			isTypeOnly: parent.parent.isTypeOnly,
			bindings: NAMESPACE,
		};
	}

	if (isLiteralTypeNode(parent) && isImportTypeNode(parent.parent)) {
		const qualifier = parent.parent.qualifier;
		return {
			specifier,
			isTypeOnly: true,
			bindings: qualifier
				? { kind: "named", names: [leftmostName(qualifier)] }
				: NAMESPACE,
		};
	}

	// Dynamic import(), require(), or anything else: assume every export may be used.
	return { specifier, isTypeOnly: false, bindings: NAMESPACE };
}

function leftmostName(name: EntityName): string {
	let current: Node = name;
	while (!isIdentifier(current) && "left" in current) {
		current = (current as { left: Node }).left;
	}
	return isIdentifier(current) ? current.text : "";
}

function forEachRequireCall(node: Node, callback: (literal: Node) => void) {
	node.forEachChild((child) => {
		if (
			isCallExpression(child) &&
			isIdentifier(child.expression) &&
			child.expression.text === "require" &&
			child.arguments.length === 1 &&
			child.arguments[0] &&
			isStringLiteral(child.arguments[0])
		) {
			callback(child.arguments[0]);
		}
		forEachRequireCall(child, callback);
	});
}
