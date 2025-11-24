import { describe, expect, it } from "vitest";
import type { FileSystemPort } from "../../core/ports.js";
import { createCapturingLogger } from "../../core/test-helpers.js";
import type { WorkspaceTypeConfig } from "../../core/types.js";
import { createConfigLoader } from "./config_loader.js";

class InMemoryFileSystem implements FileSystemPort {
	#files = new Map<string, string>();
	writtenPaths: string[] = [];

	constructor(initialFiles: Record<string, string> = {}) {
		for (const [path, contents] of Object.entries(initialFiles)) {
			this.#files.set(path, contents);
		}
	}

	async readJson<T>(path: string): Promise<T> {
		return JSON.parse(await this.readText(path)) as T;
	}

	async writeJson(path: string, value: unknown): Promise<void> {
		await this.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
	}

	fileExists(path: string): Promise<boolean> {
		return Promise.resolve(this.#files.has(path));
	}

	readText(path: string): Promise<string> {
		if (!this.#files.has(path)) {
			throw new Error(`File not found: ${path}`);
		}
		return Promise.resolve(this.#files.get(path) as string);
	}

	writeText(path: string, contents: string): Promise<void> {
		this.writtenPaths.push(path);
		this.#files.set(path, contents);
		return Promise.resolve();
	}
}

describe("config loader", () => {
	it("parses existing config", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      // comment line
      "defaultDependencies": ["react"],
      "workspaceTypes": {
        "apps/*": { "type": "app", "subType": "website" }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		const expectedWorkspace: WorkspaceTypeConfig = {
			type: "app",
			subType: "website",
		};
		expect(config.defaultDependencies).toEqual(["react"]);
		expect(config.workspaceTypes?.["apps/*"]).toEqual(expectedWorkspace);
		expect(
			logger.infos.some((msg) => msg.includes("Loading serenity-now config")),
		).toBe(true);
	});

	it("creates template when missing", async () => {
		const fs = new InMemoryFileSystem();
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("Configuration file created");

		expect(fs.writtenPaths).toEqual(["/repo/serenity-now.config.jsonc"]);
		expect(
			logger.infos.some((msg) =>
				msg.includes("Created serenity-now config template"),
			),
		).toBe(true);
	});

	it("validates workspace type entries", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "packages/*": { "type": "invalid" }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("workspaceTypes");
	});

	it("parses all optional fields", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": { "type": "app" }
      },
      "excludePatterns": ["**/*.spec.ts", "**/*.test.ts"],
      "universalUtilities": ["@repo/shared", "@repo/common"],
      "enforceNamePrefix": "@repo/",
      "ignoreProjects": ["docs"],
      "ignoreImports": ["node:*"],
      "tsconfig": {
        "preserveOutDir": true,
        "typeOnlyInDevDependencies": false,
        "incremental": true
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.excludePatterns).toEqual(["**/*.spec.ts", "**/*.test.ts"]);
		expect(config.universalUtilities).toEqual(["@repo/shared", "@repo/common"]);
		expect(config.enforceNamePrefix).toBe("@repo/");
		expect(config.ignoreProjects).toEqual(["docs"]);
		expect(config.ignoreImports).toEqual(["node:*"]);
		expect(config.tsconfig?.preserveOutDir).toBe(true);
		expect(config.tsconfig?.typeOnlyInDevDependencies).toBe(false);
		expect(config.tsconfig?.incremental).toBe(true);
	});

	it("parses minimal optional fields", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": { "type": "app" }
      },
      "excludePatterns": ["**/*.spec.ts"],
      "universalUtilities": ["@repo/shared"],
      "enforceNamePrefix": "@repo/"
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.excludePatterns).toEqual(["**/*.spec.ts"]);
		expect(config.universalUtilities).toEqual(["@repo/shared"]);
		expect(config.enforceNamePrefix).toBe("@repo/");
	});

	it("handles JSONC with escaped quotes in strings", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": { "type": "app" }
      },
      "ignoreImports": ["Test \\"quoted\\" value"]
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.workspaceTypes?.["apps/*"]).toBeDefined();
		expect(config.ignoreImports?.[0]).toBe('Test "quoted" value');
	});

	it("handles JSONC with multi-line comments", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      /* This is a
         multi-line comment
         that spans multiple lines */
      "workspaceTypes": {
        "apps/*": { "type": "app" }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.workspaceTypes?.["apps/*"]).toBeDefined();
	});

	it("handles JSONC with single-line comments containing newlines", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      // First comment
      "workspaceTypes": {
        // Second comment
        "apps/*": { "type": "app" }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.workspaceTypes?.["apps/*"]).toBeDefined();
	});

	it("returns undefined when custom config path does not exist", async () => {
		const fs = new InMemoryFileSystem();
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load(
				{ rootDir: "/repo", configPath: "/custom/path.json" },
				logger,
				fs,
			),
		).rejects.toThrow("Configuration file created");
	});

	it("warns about deprecated enforceNamePrefix without workspaceTypes", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "enforceNamePrefix": "@repo/"
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.enforceNamePrefix).toBe("@repo/");
		expect(
			logger.warns.some((msg) =>
				msg.includes("enforceNamePrefix is deprecated"),
			),
		).toBe(true);
	});

	it("handles strings with comment-like content", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": { "type": "app", "note": "Use // for comments" }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.workspaceTypes?.["apps/*"]).toBeDefined();
	});

	it("handles absolute custom config path", async () => {
		const fs = new InMemoryFileSystem({
			"/custom/config.json": `{
      "workspaceTypes": {
        "apps/*": { "type": "app" }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load(
			{ rootDir: "/repo", configPath: "/custom/config.json" },
			logger,
			fs,
		);

		expect(config.workspaceTypes?.["apps/*"]).toBeDefined();
	});

	it("handles relative custom config path", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/custom/config.json": `{
      "workspaceTypes": {
        "apps/*": { "type": "app" }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load(
			{ rootDir: "/repo", configPath: "custom/config.json" },
			logger,
			fs,
		);

		expect(config.workspaceTypes?.["apps/*"]).toBeDefined();
	});

	it("handles packageJsonTemplate in workspace config", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": {
          "type": "app",
          "packageJsonTemplate": {
            "private": true,
            "version": "1.0.0"
          }
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.workspaceTypes?.["apps/*"]?.packageJsonTemplate).toEqual({
			private: true,
			version: "1.0.0",
		});
	});

	it("handles tsconfigTemplate in workspace config", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "packages/*": {
          "type": "shared-package",
          "tsconfigTemplate": {
            "extends": "../../tsconfig.base.json",
            "compilerOptions": {
              "declaration": true
            }
          }
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.workspaceTypes?.["packages/*"]?.tsconfigTemplate).toEqual({
			extends: "../../tsconfig.base.json",
			compilerOptions: {
				declaration: true,
			},
		});
	});

	it("handles requiresTsconfig in workspace config", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "scripts/*": {
          "type": "app",
          "requiresTsconfig": false
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.workspaceTypes?.["scripts/*"]?.requiresTsconfig).toBe(false);
	});

	it("validates enforceNamePrefix must be string or false", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": {
          "type": "app",
          "enforceNamePrefix": 123
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("enforceNamePrefix must be a string or false");
	});

	it("allows enforceNamePrefix to be false", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": {
          "type": "app",
          "enforceNamePrefix": false
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		const config = await loader.load({ rootDir: "/repo" }, logger, fs);

		expect(config.workspaceTypes?.["apps/*"]?.enforceNamePrefix).toBe(false);
	});

	it("validates subType must be a string", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": {
          "type": "app",
          "subType": 123
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("must be a string");
	});

	it("validates packageJsonTemplate must be an object", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": {
          "type": "app",
          "packageJsonTemplate": "not an object"
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("must be an object");
	});

	it("validates tsconfigTemplate must be an object", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": {
          "type": "app",
          "tsconfigTemplate": "not an object"
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("must be an object");
	});

	it("validates ignoreImports must be an array", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": { "type": "app" }
      },
      "ignoreImports": "not an array"
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("must be an array of strings");
	});

	it("validates ignoreImports array items must be strings", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": { "type": "app" }
      },
      "ignoreImports": ["valid", 123, "also-valid"]
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("must contain only strings");
	});

	it("validates requiresTsconfig must be a boolean", async () => {
		const fs = new InMemoryFileSystem({
			"/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "apps/*": {
          "type": "app",
          "requiresTsconfig": "not a boolean"
        }
      }
    }`,
		});
		const logger = createCapturingLogger();
		const loader = createConfigLoader();

		await expect(() =>
			loader.load({ rootDir: "/repo" }, logger, fs),
		).rejects.toThrow("must be a boolean");
	});
});
