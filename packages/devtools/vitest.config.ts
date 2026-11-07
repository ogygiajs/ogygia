import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { pluginTests } from '@ogygia/tooling/vitest';

const base = pluginTests();
// the stores' drivers (optional peers, not installed here): stand-ins the store tests count
const drivers = {
	pg: fileURLToPath(new URL('./test/_drivers/pg.ts', import.meta.url)),
	redis: fileURLToPath(new URL('./test/_drivers/redis.ts', import.meta.url))
};

export default defineConfig({
	...base,
	resolve: { ...base.resolve, alias: { ...(base.resolve?.alias as object), ...drivers } }
});
