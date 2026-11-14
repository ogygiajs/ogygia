import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
export default {
	// the two builds sit side by side: JUMPSTART=1 builds into .svelte-kit-jumpstart and build-jumpstart
	kit: {
		outDir: process.env.JUMPSTART_OUT || '.svelte-kit',
		adapter: adapter({ out: process.env.JUMPSTART ? 'build-jumpstart' : 'build' })
	}
};
