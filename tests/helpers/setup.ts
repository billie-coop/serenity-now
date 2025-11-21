import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { PackageJson } from "../../src/core/types.ts";

/**
 * Helper to create a monorepo structure in a directory
 * NOTE: This should only be used for integration tests.
 * Unit tests should use mocks, stubs, and spies.
 */
export async function setupMonorepo(
  dir: string,
  structure: {
    root?: PackageJson;
    packages?: Record<string, PackageJson>;
    apps?: Record<string, PackageJson>;
    websites?: Record<string, PackageJson>;
    files?: Record<string, string>;
  },
): Promise<void> {
  // Create root package.json with workspaces
  if (structure.root) {
    await Deno.writeTextFile(
      join(dir, "package.json"),
      JSON.stringify(structure.root, null, 2),
    );
  } else {
    // Default root package.json
    const workspaces: string[] = [];
    if (structure.packages) workspaces.push("packages/*");
    if (structure.apps) workspaces.push("apps/*");
    if (structure.websites) workspaces.push("websites/*");

    await Deno.writeTextFile(
      join(dir, "package.json"),
      JSON.stringify({ workspaces }, null, 2),
    );
  }

  // Create packages
  if (structure.packages) {
    for (const [name, packageJson] of Object.entries(structure.packages)) {
      const packageDir = join(dir, "packages", name);
      await ensureDir(packageDir);
      await Deno.writeTextFile(
        join(packageDir, "package.json"),
        JSON.stringify(packageJson, null, 2),
      );
      // Create default tsconfig.json for every package
      await Deno.writeTextFile(
        join(packageDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { incremental: true } }, null, 2),
      );
    }
  }

  // Create apps
  if (structure.apps) {
    for (const [name, packageJson] of Object.entries(structure.apps)) {
      const appDir = join(dir, "apps", name);
      await ensureDir(appDir);
      await Deno.writeTextFile(
        join(appDir, "package.json"),
        JSON.stringify(packageJson, null, 2),
      );
      // Create default tsconfig.json for every app
      await Deno.writeTextFile(
        join(appDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { incremental: true } }, null, 2),
      );
    }
  }

  // Create websites
  if (structure.websites) {
    for (const [name, packageJson] of Object.entries(structure.websites)) {
      const websiteDir = join(dir, "websites", name);
      await ensureDir(websiteDir);
      await Deno.writeTextFile(
        join(websiteDir, "package.json"),
        JSON.stringify(packageJson, null, 2),
      );
      // Create default tsconfig.json for every website
      await Deno.writeTextFile(
        join(websiteDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { incremental: true } }, null, 2),
      );
    }
  }

  // Create arbitrary files
  if (structure.files) {
    for (const [path, content] of Object.entries(structure.files)) {
      const fullPath = join(dir, path);
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      await ensureDir(parentDir);
      await Deno.writeTextFile(fullPath, content);
    }
  }
}

/**
 * Helper to create TypeScript files with imports
 */
export async function createSourceFile(
  dir: string,
  relativePath: string,
  imports: string[],
  content = "",
): Promise<void> {
  const importStatements = imports
    .map((imp) => `import { something } from "${imp}";`)
    .join("\n");

  const fileContent = `${importStatements}\n\n${
    content || "export const test = true;"
  }`;

  const fullPath = join(dir, relativePath);
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await ensureDir(parentDir);
  await Deno.writeTextFile(fullPath, fileContent);
}

/**
 * Create a standard test monorepo
 */
export async function createStandardMonorepo(dir: string): Promise<void> {
  await setupMonorepo(dir, {
    packages: {
      utils: {
        name: "@test/utils",
        version: "1.0.0",
        main: "src/index.ts",
        types: "src/index.ts",
      },
      ui: {
        name: "@test/ui",
        version: "1.0.0",
        main: "src/index.ts",
        types: "src/index.ts",
      },
      core: {
        name: "@test/core",
        version: "1.0.0",
        main: "src/index.ts",
        types: "src/index.ts",
      },
    },
    apps: {
      web: {
        name: "@test/web",
        version: "1.0.0",
        private: true,
      },
      mobile: {
        name: "@test/mobile",
        version: "1.0.0",
        private: true,
      },
    },
  });
}
