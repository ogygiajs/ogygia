import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess()],
	compilerOptions: { experimental: { async: true } },
	// (one build, never deployed: its version is fixed, so a rebuild is the same world, test/builds.test.ts)
	kit: { adapter: adapter(), version: { name: 'peer' } }
};

export default config;
