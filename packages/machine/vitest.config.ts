import { defineConfig } from 'vitest/config';
import { browser_runs, pluginTests } from '@ogygia/config/vitest';

// Every test runs in node (the server and the compiler use machines) and in real browsers (the
// runtime does): Chromium, Firefox and WebKit, or real Safari (`OGYGIA_BROWSERS`), so no host's
// timers, AbortSignal or promise order is taken on faith.
const base = pluginTests();
const browsers = await browser_runs();

export default defineConfig({
	...base,
	test: {
		projects: [
			{
				extends: true,
				test: { name: 'node', include: ['test/**/*.test.ts'], environment: 'node' }
			},
			{
				extends: true,
				// `using` lowered as an app's build ships it to browsers without it (WebKit, Safari):
				// the transform's helpers, with the registered dispose symbols the package falls back to
				oxc: { target: 'es2022' },
				test: {
					name: 'browser',
					include: ['test/**/*.test.ts'],
					// (a real Node process of its own: node only)
					exclude: ['test/**/*.node.test.ts'],
					browser: {
						enabled: true,
						headless: true,
						...browsers
					}
				}
			}
		]
	}
});
