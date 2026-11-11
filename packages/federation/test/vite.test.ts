import { describe, expect, it } from 'vitest';
import type { Plugin, UserConfig } from 'vite';
import { federation } from '../src/vite.ts';

describe('federation()', () => {
	it('inlines @ogygia/router in the server build, as it ships .svelte files, even when the app does not list router()', () => {
		const [, vite] = federation();
		const config = (vite as Plugin & { config: () => UserConfig }).config();
		expect(config.ssr?.noExternal).toContain('@ogygia/router');
	});
});
