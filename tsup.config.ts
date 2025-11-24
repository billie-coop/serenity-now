import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		cli: "src/cli.ts",
		index: "src/core/repo_manager.ts",
	},
	format: ["esm"],
	target: "node18",
	clean: true,
	shims: true,
	dts: true,
	splitting: false,
	treeshake: true,
	minify: false,
	sourcemap: true,
});
