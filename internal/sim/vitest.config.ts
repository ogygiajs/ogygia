import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// (.scratch: a shrink's test and hand probes, gitignored; `vitest run .scratch/found/<name>`)
		include: ['test/**/*.test.ts', '.scratch/**/*.test.ts'],
		// a tab's modules run as vm.SourceTextModule (src/modules.ts)
		pool: 'forks',
		execArgv: ['--experimental-vm-modules', '--no-warnings'],
		testTimeout: 120_000
	}
});
