import vercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess()],
	compilerOptions: {
		experimental: { async: true }
	},
	kit: {
		adapter: vercel({ runtime: 'nodejs22.x' }),
		experimental: { remoteFunctions: true },
		// An app alias, the import shape the island-closure walk must follow (e2e/shared-page-module):
		// a module reached only through it is shared by a csr=true page and an island.
		alias: { $boot: 'src/lib/boot' },
		// Kit's own inline-vs-link number, which ogygia's region CSS obeys too: a region sheet under
		// it ships as `<style data-ogygia-region-css>` instead of a blocking `<link>`. Small on
		// purpose — only the tiny sheets of e2e/inline-css inline; every other suite keeps its links.
		inlineStyleThreshold: 400,
		// A sim build's version is its id, so a rebuild of the same code is the same world
		// (internal/sim/test/builds.test.ts); elsewhere Kit's own.
		version: { name: process.env.VITE_SIM_BUILD }
	}
};

export default config;
