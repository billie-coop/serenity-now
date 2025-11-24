import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeFileSystem } from "./node_fs.js";

describe("node file system", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "node-fs-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("reads JSON files", async () => {
		const testPath = join(tempDir, "test.json");
		await writeFile(testPath, JSON.stringify({ foo: "bar" }));
		const result = await nodeFileSystem.readJson<{ foo: string }>(testPath);
		expect(result).toEqual({ foo: "bar" });
	});

	it("throws error on invalid JSON", async () => {
		const testPath = join(tempDir, "invalid.json");
		await writeFile(testPath, "not valid json{");
		await expect(nodeFileSystem.readJson(testPath)).rejects.toThrow();
	});

	it("writes JSON files", async () => {
		const testPath = join(tempDir, "write.json");
		await nodeFileSystem.writeJson(testPath, { test: "data" });
		const content = await nodeFileSystem.readText(testPath);
		expect(content).toContain('"test": "data"');
	});

	it("checks if file exists (true)", async () => {
		const testPath = join(tempDir, "exists.txt");
		await writeFile(testPath, "content");
		const exists = await nodeFileSystem.fileExists(testPath);
		expect(exists).toBe(true);
	});

	it("checks if file exists (false)", async () => {
		const testPath = join(tempDir, "does-not-exist.txt");
		const exists = await nodeFileSystem.fileExists(testPath);
		expect(exists).toBe(false);
	});

	it("throws error for non-ENOENT file system errors", async () => {
		// Use an invalid path that will cause a different error than ENOENT
		// On most systems, checking a path that's too long or has invalid characters
		// will throw a different error
		const invalidPath = "\0invalid";
		await expect(nodeFileSystem.fileExists(invalidPath)).rejects.toThrow();
	});

	it("reads text files", async () => {
		const testPath = join(tempDir, "text.txt");
		await writeFile(testPath, "Hello World");
		const content = await nodeFileSystem.readText(testPath);
		expect(content).toBe("Hello World");
	});

	it("writes text files", async () => {
		const testPath = join(tempDir, "write-text.txt");
		await nodeFileSystem.writeText(testPath, "Test Content");
		const content = await nodeFileSystem.readText(testPath);
		expect(content).toBe("Test Content");
	});
});
