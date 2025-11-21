// Utility functions for file operations and path handling

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FixMe, PackageJson, TsConfig } from '../core/types';

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T = FixMe>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

export async function writeJson(filePath: string, data: FixMe): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function tryReadJson<T = FixMe>(filePath: string, defaultValue: T): Promise<T> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return defaultValue;
  }
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function getRelativePath(from: string, to: string): string {
  return normalizePath(path.relative(from, to));
}

export async function readPackageJson(dir: string): Promise<PackageJson | null> {
  const pkgPath = path.join(dir, 'package.json');
  if (!(await fileExists(pkgPath))) {
    return null;
  }
  return readJson<PackageJson>(pkgPath);
}

export async function readTsConfig(dir: string): Promise<TsConfig | null> {
  const tsConfigPath = path.join(dir, 'tsconfig.json');
  if (!(await fileExists(tsConfigPath))) {
    return null;
  }
  return readJson<TsConfig>(tsConfigPath);
}

export function isWorkspaceDependency(version: string): boolean {
  return (
    version === 'workspace:*' ||
    version === 'workspace:^' ||
    version === 'workspace:~' ||
    version.startsWith('workspace:')
  );
}

export function sortObjectKeys<T extends Record<string, FixMe>>(obj: T): T {
  const sorted: FixMe = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}
