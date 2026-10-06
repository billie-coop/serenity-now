import type { JsonObject, JsonValue } from "./types.js";

export type JsonPath = Array<string | number>;

/** A single change to a JSON document. `value: undefined` removes the property. */
export interface JsonEdit {
	path: JsonPath;
	value: JsonValue | undefined;
	/** Insert new object keys in alphabetical position instead of at the end. */
	sortedInsert?: boolean;
}

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonEqual(
	a: JsonValue | undefined,
	b: JsonValue | undefined,
): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
	}
	if (isJsonObject(a) && isJsonObject(b)) {
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every((k) => k in b && jsonEqual(a[k], b[k]))
		);
	}
	return false;
}

/** Merges `source` into `target`. Objects merge recursively; anything else is replaced. */
export function deepMerge(target: JsonObject, source: JsonObject): JsonObject {
	const result: JsonObject = { ...target };
	for (const [key, value] of Object.entries(source)) {
		const current = result[key];
		result[key] =
			isJsonObject(value) && isJsonObject(current)
				? deepMerge(current, value)
				: value;
	}
	return result;
}
