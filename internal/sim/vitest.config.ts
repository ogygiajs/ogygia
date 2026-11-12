import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		// a tab's modules run as vm.SourceTextModule (src/modules.ts)
		pool: 'forks',
		execArgv: ['--experimental-vm-modules', '--no-warnings'],
		testTimeout: 120_000
	}
});
