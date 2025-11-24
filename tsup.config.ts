import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/cli.ts"],
	format: ["esm"],
	target: "node18",
	clean: true,
	shims: true,
	dts: false,
	splitting: false,
	treeshake: true,
	minify: false,
	sourcemap: true,
});
