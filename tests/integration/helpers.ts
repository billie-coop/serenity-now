import { dirname, join } from "@std/path";

export async function writeJsonFile(
  path: string,
  value: unknown,
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextFile(
  path: string,
  value: string,
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, value);
}

export interface TempRepo {
  root: string;
  appPackage?: string;
  appTsconfig?: string;
  teardown(): Promise<void>;
}

export interface TempRepoOptions {
  includeStale?: boolean;
  missingTsconfig?: boolean;
  defaultDependencies?: string[];
  skipConfig?: boolean;
  enforcePrefix?: string;
}

export async function createTempRepo(
  options: TempRepoOptions = {},
): Promise<TempRepo> {
  const includeStale = options.includeStale ?? true;
  const missingTsconfig = options.missingTsconfig ?? false;
  const root = await Deno.makeTempDir({ prefix: "serenity-integration-" });

  await writeJsonFile(join(root, "package.json"), {
    name: "serenity-integration",
    private: true,
    workspaces: ["apps/*", "packages/*"],
  });

  if (!options.skipConfig) {
    const config = {
      workspaceTypes: {
        "apps/*": {
          type: "app",
          enforceNamePrefix: options.enforcePrefix,
        },
        "packages/*": { type: "shared-package" },
      },
      defaultDependencies: options.defaultDependencies,
    };
    await writeTextFile(
      join(root, "serenity-now.config.jsonc"),
      JSON.stringify(config, null, 2),
    );
  }

  const appDir = join(root, "apps/web");
  const appPackage = join(appDir, "package.json");
  const appTsconfig = join(appDir, "tsconfig.json");
  await writeJsonFile(appPackage, {
    name: options.enforcePrefix ? "app-web" : "@repo/app-web",
    version: "0.0.0",
    dependencies: includeStale
      ? {
        "@repo/unused": "workspace:*",
        lodash: "^4.17.0",
      }
      : {
        "@repo/lib": "workspace:*",
        lodash: "^4.17.0",
      },
  });
  if (!missingTsconfig) {
    await writeJsonFile(appTsconfig, {
      compilerOptions: {
        baseUrl: ".",
        paths: includeStale ? { "@repo/unused": ["../unused/src/index.ts"] } : {
          "@repo/lib": ["../../packages/lib/src/index.ts"],
          "@repo/lib/*": ["../../packages/lib/src/*"],
        },
      },
      references: includeStale
        ? [{ path: "../unused" }]
        : [{ path: "../../packages/lib" }],
    });
  }
  const staleImport = includeStale ? 'import "@repo/unused";\n' : "";
  await writeTextFile(
    join(appDir, "src/main.ts"),
    `${staleImport}import { greeting } from "@repo/lib";
console.log(greeting);`,
  );

  const libDir = join(root, "packages/lib");
  await writeJsonFile(join(libDir, "package.json"), {
    name: "@repo/lib",
    version: "0.0.0",
  });
  await writeJsonFile(join(libDir, "tsconfig.json"), {
    compilerOptions: {},
  });
  await writeTextFile(
    join(libDir, "src/index.ts"),
    `export const greeting = "hello";`,
  );

  return {
    root,
    appPackage,
    appTsconfig,
    async teardown() {
      await Deno.remove(root, { recursive: true });
    },
  };
}

export async function createCycleRepo(): Promise<TempRepo> {
  const root = await Deno.makeTempDir({ prefix: "serenity-cycle-" });

  await writeJsonFile(join(root, "package.json"), {
    name: "serenity-cycle",
    private: true,
    workspaces: ["packages/*"],
  });

  await writeTextFile(
    join(root, "serenity-now.config.jsonc"),
    JSON.stringify(
      { workspaceTypes: { "packages/*": { type: "shared-package" } } },
      null,
      2,
    ),
  );

  const pkgDir = (name: string) => join(root, "packages", name);

  await writeJsonFile(join(pkgDir("a"), "package.json"), {
    name: "@repo/a",
    version: "0.0.0",
  });
  await writeJsonFile(join(pkgDir("a"), "tsconfig.json"), {
    compilerOptions: {},
  });
  await writeTextFile(
    join(pkgDir("a"), "src/index.ts"),
    `import { b } from "@repo/b";
export const a = "a" + b;`,
  );

  await writeJsonFile(join(pkgDir("b"), "package.json"), {
    name: "@repo/b",
    version: "0.0.0",
  });
  await writeJsonFile(join(pkgDir("b"), "tsconfig.json"), {
    compilerOptions: {},
  });
  await writeTextFile(
    join(pkgDir("b"), "src/index.ts"),
    `import { a } from "@repo/a";
export const b = "b" + a;`,
  );

  return {
    root,
    async teardown() {
      await Deno.remove(root, { recursive: true });
    },
  };
}

export function captureConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = ((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  }) as typeof console.log;
  console.error = ((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  }) as typeof console.error;
  return {
    logs,
    errors,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

export async function createDiamondRepo(): Promise<TempRepo> {
  const root = await Deno.makeTempDir({ prefix: "serenity-diamond-" });

  await writeJsonFile(join(root, "package.json"), {
    name: "serenity-diamond",
    private: true,
    workspaces: ["apps/*", "packages/*"],
  });

  await writeJsonFile(join(root, "serenity-now.config.jsonc"), {
    workspaceTypes: {
      "apps/*": { type: "app" },
      "packages/*": { type: "shared-package" },
    },
  });

  const writePackage = async (dir: string, name: string, code: string) => {
    await writeJsonFile(join(dir, "package.json"), { name, version: "0.0.0" });
    await writeJsonFile(join(dir, "tsconfig.json"), { compilerOptions: {} });
    await writeTextFile(join(dir, "src/index.ts"), code);
  };

  await writePackage(
    join(root, "packages/utils"),
    "@repo/utils",
    `export const utils = 1;`,
  );
  await writePackage(
    join(root, "packages/feature"),
    "@repo/feature",
    `import { utils } from "@repo/utils";
export const feature = utils + 1;`,
  );
  await writePackage(
    join(root, "packages/shared"),
    "@repo/shared",
    `import { utils } from "@repo/utils";
export const shared = utils + 2;`,
  );
  await writePackage(
    join(root, "apps/web"),
    "@repo/web",
    `import { feature } from "@repo/feature";
import { shared } from "@repo/shared";
export const result = feature + shared;`,
  );

  return {
    root,
    async teardown() {
      await Deno.remove(root, { recursive: true });
    },
  };
}
