import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConsoleLogger } from "./console_logger.js";

function captureConsole() {
	const originalLog = console.log;
	const originalWarn = console.warn;
	const originalError = console.error;
	const logs: string[] = [];
	const warns: string[] = [];
	const errors: string[] = [];

	console.log = ((...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	}) as typeof console.log;

	console.warn = ((...args: unknown[]) => {
		warns.push(args.map(String).join(" "));
	}) as typeof console.warn;

	console.error = ((...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	}) as typeof console.error;

	return {
		logs,
		warns,
		errors,
		restore() {
			console.log = originalLog;
			console.warn = originalWarn;
			console.error = originalError;
		},
	};
}

describe("console logger", () => {
	let capture: ReturnType<typeof captureConsole>;

	beforeEach(() => {
		capture = captureConsole();
	});

	afterEach(() => {
		capture.restore();
	});

	it("logs phase messages", () => {
		const logger = createConsoleLogger();
		logger.phase("Test Phase");
		expect(
			capture.logs.some((line) => line.includes("Phase: Test Phase")),
		).toBe(true);
	});

	it("logs info messages", () => {
		const logger = createConsoleLogger();
		logger.info("Test info");
		expect(capture.logs.some((line) => line.includes("Test info"))).toBe(true);
	});

	it("logs warnings and tracks them", () => {
		const logger = createConsoleLogger();
		logger.warn("Test warning");
		expect(capture.warns.some((line) => line.includes("Test warning"))).toBe(
			true,
		);
		const warnings = logger.getWarnings?.();
		expect(warnings).toHaveLength(1);
		expect(warnings?.[0]).toBe("Test warning");
	});

	it("logs error messages", () => {
		const logger = createConsoleLogger();
		logger.error("Test error");
		expect(capture.errors.some((line) => line.includes("Test error"))).toBe(
			true,
		);
	});

	it("logs debug messages when verbose=true", () => {
		const logger = createConsoleLogger(true);
		logger.debug("Test debug");
		expect(capture.logs.some((line) => line.includes("Test debug"))).toBe(true);
	});

	it("skips debug messages when verbose=false", () => {
		const logger = createConsoleLogger(false);
		logger.debug("Test debug");
		expect(capture.logs.some((line) => line.includes("Test debug"))).toBe(
			false,
		);
	});

	it("logs success messages", () => {
		const logger = createConsoleLogger();
		logger.success("Test success");
		expect(capture.logs.some((line) => line.includes("Test success"))).toBe(
			true,
		);
	});
});
