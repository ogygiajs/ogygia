import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess()],
	compilerOptions: { experimental: { async: true } },
	// (remote functions: a held region is a query's answer, a live one a live query's ticks)
	kit: {
		adapter: adapter(),
		experimental: { remoteFunctions: true },
		// (a sim build's version is its id: a rebuild of the same code is the same world, test/builds.test.ts)
		version: { name: process.env.VITE_SIM_BUILD }
	}
};

export default config;
