import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { ogygia } from 'ogygia/vite';
import { flags } from '@ogygia/flags/vite';
import { federation } from '@ogygia/federation/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		ogygia(),
		flags(),
		federation(),
		// SvelteKit's config (Kit 3: passed to `sveltekit()`; a `svelte.config.js` is an error)
		sveltekit({
			adapter: adapter(),
			preprocess: [vitePreprocess()],
			compilerOptions: { experimental: { async: true } }
		})
	],
	// cors: the SHELL page (another origin) dynamic-imports this app's island chunks.
	// In production this is one header on the CDN; for the POC, vite preview's cors flag.
	preview: { cors: true },
	server: { cors: true }
});
