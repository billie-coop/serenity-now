import {
	applyEdits,
	type FormattingOptions,
	findNodeAtLocation,
	format,
	modify,
	type ParseError,
	parse,
	parseTree,
	printParseErrorCode,
} from "jsonc-parser";
import { ConfigurationError } from "../../core/errors.js";
import type { JsonEdit } from "../../core/json.js";
import type { JsonValue } from "../../core/types.js";

/**
 * Parses JSON with comments and trailing commas (the format of tsconfig.json
 * and serenity-now.config.jsonc). Throws a ConfigurationError pointing at the
 * first syntax error.
 */
export function parseJsonc(text: string, filePath: string): JsonValue {
	const errors: ParseError[] = [];
	const value = parse(text, errors, {
		allowTrailingComma: true,
		disallowComments: false,
	}) as JsonValue;
	const [first] = errors;
	if (first) {
		const { line, column } = lineAndColumn(text, first.offset);
		throw new ConfigurationError(
			`${filePath}:${line}:${column}: invalid JSON (${printParseErrorCode(first.error)})`,
		);
	}
	return value;
}

/**
 * Applies edits to JSON text, preserving comments, key order and the file's
 * existing formatting. Only newly written values are formatted (with the
 * file's indentation style); surrounding entries are left byte-for-byte as
 * they were.
 */
export function applyJsonEdits(text: string, edits: JsonEdit[]): string {
	const formattingOptions = detectFormatting(text);
	let result = text;
	for (const edit of edits) {
		const adjusted = withExistingParent(result, edit);
		if (!adjusted) continue;
		const { path, value } = adjusted;
		const key = String(path[path.length - 1]);
		// No formattingOptions here: jsonc-parser would also reformat the
		// neighbouring entry. Format just the edited text afterwards instead.
		const changes = modify(result, path, value, {
			getInsertionIndex:
				edit.sortedInsert && path === edit.path
					? (keys) => {
							const index = keys.findIndex((k) => k.localeCompare(key) > 0);
							return index === -1 ? keys.length : index;
						}
					: undefined,
		});
		result = applyEdits(result, changes);
		for (const change of changes) {
			result = formatAround(
				result,
				change.offset,
				change.offset + change.content.length,
				formattingOptions,
			);
		}
	}
	return result;
}

/**
 * When an edit adds a key to an object that doesn't exist yet, set the
 * nearest missing ancestor to a new object instead, so new parents are
 * appended rather than sorted against the wrong key. Removals of missing
 * paths are dropped.
 */
function withExistingParent(
	text: string,
	edit: JsonEdit,
): JsonEdit | undefined {
	const tree = parseTree(text);
	if (edit.value === undefined) {
		// Removing something that isn't there is a no-op.
		return tree && findNodeAtLocation(tree, edit.path) ? edit : undefined;
	}
	let depth = edit.path.length - 1;
	while (
		depth > 0 &&
		(!tree || !findNodeAtLocation(tree, edit.path.slice(0, depth)))
	) {
		depth--;
	}
	if (depth === edit.path.length - 1) return edit;
	let value: JsonValue = edit.value;
	for (let i = edit.path.length - 1; i > depth; i--) {
		value = { [String(edit.path[i])]: value };
	}
	return { path: edit.path.slice(0, depth + 1), value };
}

/**
 * Formats the text from `from` to `to`, widened to include the first character
 * of the neighbouring token on each side, so the whitespace joining it to its
 * neighbours is fixed too (and a CRLF is never split). The neighbouring
 * values themselves aren't reformatted.
 */
function formatAround(
	text: string,
	from: number,
	to: number,
	options: FormattingOptions,
): string {
	let start = from;
	while (start > 0 && /\s/.test(text[start - 1] as string)) start--;
	start = Math.max(0, start - 1);
	let end = to;
	while (end < text.length && /\s/.test(text[end] as string)) end++;
	end = Math.min(text.length, end + 1);
	return applyEdits(
		text,
		format(text, { offset: start, length: end - start }, options),
	);
}

function detectFormatting(text: string): FormattingOptions {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "\t";
	return indent.startsWith("\t")
		? { insertSpaces: false, tabSize: 1, eol }
		: { insertSpaces: true, tabSize: indent.length, eol };
}

function lineAndColumn(
	text: string,
	offset: number,
): { line: number; column: number } {
	const before = text.slice(0, offset).split("\n");
	return {
		line: before.length,
		column: (before[before.length - 1]?.length ?? 0) + 1,
	};
}
