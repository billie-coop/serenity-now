// File system utilities
// Deno version using built-in APIs

import { exists } from "@std/fs/exists";

export async function fileExists(path: string): Promise<boolean> {
  try {
    return await exists(path, { isFile: true });
  } catch {
    return false;
  }
}

export async function dirExists(path: string): Promise<boolean> {
  try {
    return await exists(path, { isDirectory: true });
  } catch {
    return false;
  }
}

export async function tryReadJson<T>(
  path: string,
  defaultValue: T,
): Promise<T> {
  try {
    const content = await Deno.readTextFile(path);
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

export async function readJson<T>(path: string): Promise<T> {
  const content = await Deno.readTextFile(path);
  return JSON.parse(content) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const content = JSON.stringify(value, null, 2);
  await Deno.writeTextFile(path, content + "\n");
}

export async function findUp(
  filename: string,
  startDir: string,
): Promise<string | null> {
  let currentDir = startDir;

  while (true) {
    const candidatePath = `${currentDir}/${filename}`;
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }

    const parentDir = Deno.realPathSync(`${currentDir}/..`);
    if (parentDir === currentDir) {
      // Reached root directory
      return null;
    }
    currentDir = parentDir;
  }
}
