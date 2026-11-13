import { defineConfig } from 'vitest/config';
import { browser_runs, pluginTests } from '@ogygia/config/vitest';

// The server half (the marks, the settle, the region splitter) runs in node; the restorer, which
// moves real DOM, runs in real browsers (`test/browser`).
const base = pluginTests();
const browsers = await browser_runs();

export default defineConfig({
	...base,
	// (bundled before the first test file loads: found during the run, Vite bundles again and
	// changes the URLs a test file still imports)
	optimizeDeps: { include: ['esm-env'] },
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					include: ['test/**/*.test.ts'],
					exclude: ['test/browser/**', 'test/browser-chunk-lost/**', '**/node_modules/**'],
					environment: 'node'
				}
			},
			{
				extends: true,
				test: {
					name: 'browser',
					include: ['test/browser/**/*.test.ts'],
					browser: { enabled: true, headless: true, ...browsers }
				}
			},
			{
				extends: true,
				plugins: [
					{
						name: 'messages-chunk-lost',
						load(id) {
							if (id.endsWith('/reshape/src/messages.ts'))
								throw new Error('the messages chunk did not load');
						}
					}
				],
				test: {
					name: 'browser-chunk-lost',
					include: ['test/browser-chunk-lost/**/*.test.ts'],
					browser: {
						enabled: true,
						headless: true,
						...browsers,
						instances: browsers.instances.map((i) => ({ ...i }))
					}
				}
			}
		]
	}
});
