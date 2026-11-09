import { defineConfig } from 'vitest/config';
import { browser_runs, pluginTests } from '@ogygia/config/vitest';

const browsers = await browser_runs();

const base = pluginTests();

// Two projects, one config:
//
// - `node`    the package's unit and dev-server tests (pluginTests: core's stubs, the Svelte plugin).
// - `browser` the site kit's components mounted in a real browser (Vitest browser mode, Playwright
//             chromium): what a component holds in the page (listeners, timers, observers) only a
//             browser tells the truth about.
export default defineConfig({
	...base,
	// The browser tests' dependencies, bundled before the first test file loads. Found during the
	// run instead, they made Vite bundle again and change their URLs under a test file still
	// importing the old ones ("Failed to import test file", seen in Firefox and Chromium on CI).
	optimizeDeps: { include: ['@orama/orama', 'bits-ui', 'esm-env', 'svelte > clsx'] },
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					include: ['test/**/*.test.ts'],
					exclude: ['test/browser/**', '**/node_modules/**'],
					environment: 'node'
				}
			},
			{
				extends: true,
				test: {
					name: 'browser',
					include: ['test/browser/**/*.test.ts'],
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
