import { defineConfig, mergeConfig } from 'vitest/config';
import { pluginTests } from '@ogygia/config/vitest';

// The suites import the BUILT `dist/` output where the plugin runs from it, so `check` builds first.
// Core's runtime messages are published the way core's own unit tests publish them.
export default defineConfig(
	mergeConfig(pluginTests(), {
		test: { setupFiles: ['../core/test/_setup/messages.ts'] }
	})
);
