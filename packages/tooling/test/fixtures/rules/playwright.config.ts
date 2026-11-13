import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: 'rules.spec.ts',
	reporter: 'list',
	retries: 0,
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
