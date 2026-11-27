// An app that never installed sharp: the plugin's Vite entry still loads, so the build can say
// which line to add, with its code, instead of a module resolution error from inside the package.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { expect, test, vi } from 'vitest';

vi.mock('sharp', () => {
	throw new Error('Cannot find package "sharp"');
});

test("image()'s Vite entry loads without sharp, and the build's first hook names the fix", async () => {
	const { image } = await import('../src/vite/index.ts');
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-nosharp-'));
	fs.writeFileSync(path.join(root, 'package.json'), '{"name":"app","private":true}');
	const plugin = image().find((p) => p.name === '@ogygia/image:load') as Plugin;
	await expect(
		Promise.resolve(
			(plugin.configResolved as (c: unknown) => unknown)({
				root,
				command: 'serve',
				build: {},
				define: { __SVELTEKIT_APP_DIR__: '"_app"' }
			} as unknown as ResolvedConfig)
		)
	).rejects.toThrow(/image_sharp_missing/);
});
