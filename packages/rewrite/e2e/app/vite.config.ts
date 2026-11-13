import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { rewrite } from '@ogygia/rewrite/vite';
import { defineConfig } from 'vite';

// THE RESTORE LAB: @ogygia/rewrite's e2e fixture app. Every page runs a rewrite (a scoped
// web-component render, hooks.server.ts); the router is on, so a navigation morphs restored hosts.
export default defineConfig({
	plugins: [ogygia({ router: true }), rewrite(), sveltekit()]
});
