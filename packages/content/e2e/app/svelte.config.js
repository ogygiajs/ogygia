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
		// Kit bakes its version (default: the build's time) into its output, so two builds compared
		// byte for byte (test/cold-warm-build.test.ts) pin it, the way a deploy keyed to a commit would.
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
