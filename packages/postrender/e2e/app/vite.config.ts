import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { ogygia } from 'ogygia/vite';
import { postrender } from '@ogygia/postrender/vite';
import { flags } from '@ogygia/flags/vite';
import { router } from '@ogygia/router/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// The postrender fixture: `postrender()` = the switch (hooks.server.ts adds `postrender.handle()`,
	// with edge adapters at the emulators when ../postrender.spec.ts boots them). `flags()`: the
	// /flagged page reads one, and that read must refuse the store. `router()`: the /r/* pages are a
	// server-router table in hooks.server.ts.
	plugins: [
		ogygia(),
		postrender(),
		flags(),
		router(),
		// SvelteKit's config (Kit 3: passed to `sveltekit()`; a `svelte.config.js` is an error)
		sveltekit({
			adapter: adapter(),
			preprocess: [vitePreprocess()],
			// Async Svelte (the live-header demo awaits a remote query in its script) + remote functions.
			compilerOptions: {
				experimental: { async: true }
			},
			experimental: { remoteFunctions: true },
			// adapter-node reads the origin at BUILD time (no runtime ORIGIN): the scenario deck serves
			// over plain http, so the build is told (playwright.config.ts) — or its POSTs fail Kit's
			// same-origin check
			...(process.env.ORIGIN ? { paths: { origin: process.env.ORIGIN } } : {})
		})
	]
});
