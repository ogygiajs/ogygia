import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: 'checks.spec.ts',
	reporter: 'list',
	retries: 0
});
