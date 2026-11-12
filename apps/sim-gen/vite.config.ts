import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { defineConfig } from 'vite';

// THE SIMULATOR'S GENERATED APP (internal/sim/src/gen.ts writes its pages and regions from a seed).
// The router is on, so a link followed is a client navigation, as in most apps.
export default defineConfig({
	plugins: [ogygia({ router: true }), sveltekit()]
});
