import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { pluginTests, stub_aliases } from '@ogygia/config/vitest';

const base = pluginTests();
// the stores' drivers (optional peers, not installed here): stand-ins the store tests count
const drivers = [
	{ find: /^pg$/, replacement: fileURLToPath(new URL('./test/_drivers/pg.ts', import.meta.url)) },
	{
		find: /^redis$/,
		replacement: fileURLToPath(new URL('./test/_drivers/redis.ts', import.meta.url))
	}
];

export default defineConfig({
	...base,
	resolve: { ...base.resolve, alias: [...stub_aliases(), ...drivers] }
});
