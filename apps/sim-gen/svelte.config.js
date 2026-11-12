import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess()],
	compilerOptions: { experimental: { async: true } },
	// (remote functions: a held region is a query's answer, a live one a live query's ticks)
	kit: { adapter: adapter(), experimental: { remoteFunctions: true } }
};

export default config;
