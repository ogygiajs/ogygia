import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { content } from '@ogygia/content/vite';
import { image } from '@ogygia/image/vite';
import { defineConfig } from 'vite';
import { encoder } from './image.config.ts';
import { REMOTE_ORIGIN, serve_remote_host } from './remote-host.ts';

await serve_remote_host();

export default defineConfig({
	define: {
		__IMAGE_E2E_STATIC__: JSON.stringify(
			process.env.IMAGE_E2E_STATIC === '1' || process.env.IMAGE_E2E_ADAPTER !== undefined
		),
		__IMAGE_E2E_LIVE__: JSON.stringify(process.env.IMAGE_E2E_ADAPTER !== undefined)
	},
	plugins: [
		ogygia(),
		content({ markdown: {} }),
		image({
			presets: {
				cover: { layout: 'fullWidth', aspect: '16/9', priority: true },
				thumb: { width: 200, aspect: '1/1' },
				avatar: { layout: 'fixed', width: 48, height: 48 },
				prose: { width: 720 },
				motion: { width: 40, sizes: '33vw' },
				hero: {
					layout: 'fullWidth',
					aspect: '16/9',
					art: [{ media: '(max-width: 600px)', aspect: '4/5', position: 'attention' }]
				}
			},
			markdown: { animated: 'motion' },
			remote: { hosts: [REMOTE_ORIGIN] },
			...(process.env.IMAGE_E2E_BASE
				? {}
				: { theme: { dark: ':root[data-theme="dark"]', light: ':root[data-theme="light"]' } }),
			...(encoder ? { encoder } : {})
		}),
		sveltekit()
	]
});
