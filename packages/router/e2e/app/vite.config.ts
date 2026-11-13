import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { router } from '@ogygia/router/vite';
import { pageKeys } from '@ogygia/page-keys';
import { defineConfig } from 'vite';

// @ogygia/router's e2e fixture app: the server router behind /rtr (and the distributed table
// repro-island-pkg ships, e2e/island-pkg). pageKeys(): a router page's seed is shaped like a Kit
// page's (e2e/router-seed.spec.ts).
export default defineConfig({
	plugins: [ogygia(), router(), pageKeys(), sveltekit()]
});
