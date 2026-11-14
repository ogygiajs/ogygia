import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { jumpstart } from '@ogygia/jumpstart';
import { defineConfig } from 'vite';

// SvelteKit 3: the project config is passed to `sveltekit()`. The switches are ../app's. One
// Svelte for the bundle: the workspace's ogygia sits beside Kit 2's Svelte
const external = (process.env.JUMPSTART_EXTERNAL || '').split(',').filter(Boolean);

export default defineConfig({
	plugins: [
		ogygia(),
		...(process.env.JUMPSTART ? [jumpstart({ external })] : []),
		sveltekit({
			outDir: process.env.JUMPSTART_OUT || '.svelte-kit',
			// oxlint-disable-next-line typescript/no-deprecated -- the source is ../app's (Kit 2), which imports through $lib
			alias: { $lib: 'src/lib' }
		})
	],
	resolve: { dedupe: ['svelte'] }
});
