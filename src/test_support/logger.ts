import type { LoggerPort } from "../core/ports.js";

/** A logger that records every message by level. */
export function createCapturingLogger(): LoggerPort & {
	messages: Record<
		"phase" | "info" | "warn" | "error" | "debug" | "success",
		string[]
	>;
} {
	const messages = {
		phase: [] as string[],
		info: [] as string[],
		warn: [] as string[],
		error: [] as string[],
		debug: [] as string[],
		success: [] as string[],
	};
	return {
		messages,
		phase: (m) => messages.phase.push(m),
		info: (m) => messages.info.push(m),
		warn: (m) => messages.warn.push(m),
		error: (m) => messages.error.push(m),
		debug: (m) => messages.debug.push(m),
		success: (m) => messages.success.push(m),
		getWarnings: () => [...messages.warn],
	};
}
