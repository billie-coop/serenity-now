import type { FileSystemPort } from "../../core/ports.ts";

async function readJson<T>(path: string): Promise<T> {
  const text = await Deno.readTextFile(path);
  return JSON.parse(text) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await Deno.writeTextFile(path, text);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

export const denoFileSystem: FileSystemPort = {
  readJson,
  writeJson,
  fileExists,
  readText: (path: string) => Deno.readTextFile(path),
  writeText: (path: string, contents: string) =>
    Deno.writeTextFile(path, contents),
};
