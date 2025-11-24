import type { LoggerPort } from "./ports.ts";

export function createMockLogger(overrides?: Partial<LoggerPort>): LoggerPort {
	return {
		phase: () => {},
		info: () => {},
		success: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
		getWarnings: () => [],
		...overrides,
	};
}

export function createCapturingLogger(): LoggerPort & {
	infos: string[];
	warns: string[];
	warnings: string[];
} {
	const infos: string[] = [];
	const warns: string[] = [];
	return {
		infos,
		warns,
		warnings: warns,
		phase: () => {},
		info: (msg: string) => infos.push(msg),
		success: () => {},
		warn: (msg: string) => warns.push(msg),
		error: () => {},
		debug: () => {},
		getWarnings: () => warns,
	};
}
