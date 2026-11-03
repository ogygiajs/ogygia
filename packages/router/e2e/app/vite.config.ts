import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { ogygia } from 'ogygia/vite';
import { router } from '@ogygia/router/vite';
import { defineConfig } from 'vite';

// @ogygia/router's e2e fixture app: the server router behind /rtr (and the distributed table
// repro-island-pkg ships, e2e/island-pkg).
export default defineConfig({
	plugins: [
		ogygia(),
		router(),
		// SvelteKit's config (Kit 3: passed to `sveltekit()`; a `svelte.config.js` is an error)
		sveltekit({
			adapter: adapter(),
			preprocess: [vitePreprocess()],
			compilerOptions: { experimental: { async: true } },
			experimental: { remoteFunctions: true }
		})
	]
});
