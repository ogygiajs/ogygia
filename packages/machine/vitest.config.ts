import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { pluginTests } from '@ogygia/config/vitest';

// Every test runs twice: in node (the server and the compiler use machines) and in a real browser
// (the runtime does), so neither host's timers, AbortSignal or promise order is taken on faith.
const base = pluginTests();

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
				test: {
					name: 'browser',
					include: ['test/**/*.test.ts'],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
