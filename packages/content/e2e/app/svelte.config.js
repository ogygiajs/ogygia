import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { preprocess, extensions } from '@ogygia/content/vite';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Markdown content (`.svx`) so the content-css spec can exercise the content-body CSS path.
	extensions: extensions(),
	preprocess: [vitePreprocess(), ...preprocess()],
	compilerOptions: {
		experimental: { async: true }
	},
	kit: {
		adapter: adapter(),
		outDir: process.env.OGYGIA_E2E_OUT_DIR,
		// @why Kit bakes its version (default: the build's time) into its output (test: test/cold-warm-build.test.ts › a warm build (the build cache kept) writes the same output, byte for byte, as a cold build of the same source, but for each build's own random key)
		...(process.env.CONTENT_E2E_KIT_VERSION
			? { version: { name: process.env.CONTENT_E2E_KIT_VERSION } }
			: {}),
		experimental: { remoteFunctions: true },
		// Kit's own inline-vs-link number, which ogygia's region CSS obeys too: a region sheet under it
		// ships as `<style data-ogygia-region-css>` instead of a blocking `<link>`
		inlineStyleThreshold: 400
	}
};

export default config;
