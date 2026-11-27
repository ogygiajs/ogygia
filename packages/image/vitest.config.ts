import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { pluginTests, stub_aliases } from '@ogygia/config/vitest';

const config = pluginTests();

export default defineConfig({
	...config,
	resolve: {
		alias: [
			...stub_aliases(),
			{
				find: /^virtual:ogygia-image\/maker$/,
				replacement: fileURLToPath(new URL('./src/makers/sharp.ts', import.meta.url))
			},
			{
				find: /^virtual:ogygia-image\/remote$/,
				replacement: fileURLToPath(new URL('./src/remote-off.ts', import.meta.url))
			},
			{
				find: /^virtual:ogygia-image\/cards$/,
				replacement: fileURLToPath(new URL('./src/cards/none.ts', import.meta.url))
			},
			{
				find: /^virtual:ogygia-image\/namer$/,
				replacement: fileURLToPath(new URL('./src/namers/endpoint.ts', import.meta.url))
			}
		]
	}
});
