import type { FileSystemPort } from "../core/ports.js";

/** An in-memory FileSystemPort. `files` maps absolute paths to contents. */
export function createMemoryFs(
	files: Record<string, string> = {},
): FileSystemPort & { files: Record<string, string> } {
	const store = { ...files };
	return {
		files: store,
		fileExists: async (path) => path in store,
		readText: async (path) => {
			const text = store[path];
			if (text === undefined) {
				throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
			}
			return text;
		},
		writeText: async (path, contents) => {
			store[path] = contents;
		},
	};
}
