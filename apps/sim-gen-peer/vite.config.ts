import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { federation } from '@ogygia/federation/vite';
import { router } from '@ogygia/router/vite';
import { defineConfig } from 'vite';

// THE SIMULATOR'S GENERATED PEER (internal/sim/src/gen.ts writes its widgets and pages from a seed):
// another team's app, which apps/sim-gen renders widgets of and mounts the pages of.
export default defineConfig({
	plugins: [ogygia(), federation(), router(), sveltekit()]
});
