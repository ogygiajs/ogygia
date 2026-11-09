import { defineConfig } from 'vitest/config';

// The harness's own tests: plain node, real child processes and ports.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
