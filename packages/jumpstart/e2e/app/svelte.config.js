/** @type {import('@sveltejs/kit').Config} */
export default {
	// JUMPSTART_OUT: a second build beside the first (../fixture.ts builds both)
	kit: { outDir: process.env.JUMPSTART_OUT || '.svelte-kit' }
};
