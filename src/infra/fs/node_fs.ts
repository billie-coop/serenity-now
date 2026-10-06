import { readFile, stat, writeFile } from "node:fs/promises";
import type { FileSystemPort } from "../../core/ports.js";

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
	fileExists,
	readText: (path: string) => readFile(path, "utf-8"),
	writeText: (path: string, contents: string) =>
		writeFile(path, contents, "utf-8"),
};
