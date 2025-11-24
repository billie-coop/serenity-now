export function assert(
	value: boolean,
	error?: Error | (() => Error),
): asserts value;
export function assert<T>(
	value: T | null | undefined,
	error?: Error | (() => Error),
): asserts value is T;
export function assert(
	value: unknown,
	error: Error | (() => Error) = () => new Error("Assertion failed"),
): asserts value {
	if (value === false || value === null || value === undefined) {
		throw typeof error === "function" ? error() : error;
	}
}
