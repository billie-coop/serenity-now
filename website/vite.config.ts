import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	// Set DOCS_BASE for subpath deploys (GitHub Pages uses /serenity-now/)
	base: process.env.DOCS_BASE || "/",
	// The docs are the repo's README and src/docs/content.ts, one level up
	server: { port: 5418, fs: { allow: [".."] } },
	preview: { port: 5418 },
});
