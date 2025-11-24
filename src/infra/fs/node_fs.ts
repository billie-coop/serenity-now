import { readFile, stat, writeFile } from "node:fs/promises";
import type { FileSystemPort } from "../../core/ports.js";

async function readJson<T>(path: string): Promise<T> {
	const text = await readFile(path, "utf-8");
	return JSON.parse(text) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
	const text = `${JSON.stringify(value, null, 2)}\n`;
	await writeFile(path, text, "utf-8");
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

export const nodeFileSystem: FileSystemPort = {
	readJson,
	writeJson,
	fileExists,
	readText: (path: string) => readFile(path, "utf-8"),
	writeText: (path: string, contents: string) =>
		writeFile(path, contents, "utf-8"),
};
