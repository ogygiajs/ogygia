import node from '@sveltejs/adapter-node';
import vercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// LAB_ADAPTER=vercel builds .vercel/output for `vercel deploy --prebuilt` (bench-vercel.ts)
const adapter =
	process.env.LAB_ADAPTER === 'vercel'
		? vercel({ runtime: 'nodejs22.x' })
		: node({ out: process.env.LAB_OUT ?? 'build' });

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess()],
	kit: { adapter }
};

export default config;
