/**
 * ANSI color codes for terminal output
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

export function bold(text: string): string {
	return `${BOLD}${text}${RESET}`;
}

export function red(text: string): string {
	return `${RED}${text}${RESET}`;
}

export function green(text: string): string {
	return `${GREEN}${text}${RESET}`;
}

export function yellow(text: string): string {
	return `${YELLOW}${text}${RESET}`;
}

export function cyan(text: string): string {
	return `${CYAN}${text}${RESET}`;
}
