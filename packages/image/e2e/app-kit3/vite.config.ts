import fs from 'node:fs';
import type { Adapter } from '@sveltejs/kit';
import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { image } from '@ogygia/image/vite';
import { defineConfig } from 'vite';

const PAGES = 'build';

const copy_prerendered: Adapter = {
	name: 'copy-prerendered',
	adapt(builder) {
		fs.rmSync(PAGES, { force: true, recursive: true });
		builder.writeClient(PAGES);
		builder.writePrerendered(PAGES);
	}
};

export default defineConfig({
	plugins: [
		ogygia(),
		image({ presets: { thumb: { width: 200, aspect: '1/1' } } }),
		sveltekit({
			adapter: copy_prerendered,
			paths: { origin: 'https://example.com' },
			prerender: { entries: ['*'] }
		})
	],
	resolve: { dedupe: ['svelte'] }
});
