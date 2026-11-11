// A bare SvelteKit app (no ogygia) with the `single-lazy` server output options: does Kit alone hang?
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		{
			name: 'repro:single-lazy',
			configEnvironment(name) {
				if (name !== 'ssr' || process.env.REPRO_PLAIN === '1') return;
				return {
					build: {
						rollupOptions: {
							output: {
								...(process.env.REPRO_NO_GROUP === '1'
									? {}
									: { codeSplitting: { groups: [{ name: 'server' }] } }),
								strictExecutionOrder: process.env.REPRO_NO_STRICT !== '1'
							}
						}
					}
				};
			}
		},
		sveltekit()
	]
});
