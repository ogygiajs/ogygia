import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { reshape } from '@ogygia/rewrite/vite';
import { defineConfig } from 'vite';

// THE RESTORE LAB: @ogygia/rewrite's e2e fixture app. Every page runs the app's own pass (a scoped
// web-component render, hooks.server.ts); the router is on, so a navigation morphs restored hosts.
export default defineConfig({
	plugins: [ogygia({ router: true }), reshape(), sveltekit()]
});
