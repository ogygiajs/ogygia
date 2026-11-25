// A cold build makes each file a prerendered page names once. Kit's prerender (a worker) names the
// file and the build starts it at once; the build's end, asking for the same file while it is still
// being made, waits for that make instead of making it again beside it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, expect, test, vi } from 'vitest';
import { __set_build_cache_root } from '@ogygia/compiler';
import { startPlugin } from '@ogygia/core/plugin/testing';
import type { RenderConfig } from '../src/config.ts';
import { id_of, make_images } from './fixtures.ts';

const encodes = vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	let open = (): void => {};
	const gate = new Promise<void>((resolve) => (open = resolve));
	return { count: 0, gate, open: () => open(), jpg: '' };
});

vi.mock('../src/pixels.ts', async (load) => {
	const real = await load<typeof import('../src/pixels.ts')>();
	return {
		...real,
		encode_recipe: async (...args: Parameters<typeof real.encode_recipe>) => {
			encodes.count++;
			if (encodes.count === 1) await encodes.gate;
			return real.encode_recipe(...args);
		}
	};
});
vi.mock('$app/environment', () => ({ building: true, dev: false }));
vi.mock('$app/server', () => ({
	read: () => new Response(fs.readFileSync(encodes.jpg))
}));
vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/h.jpg': '/_app/immutable/assets/h.Ab12.jpg' },
	remote: []
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));

const CFG: RenderConfig = {
	formats: ['webp'],
	breakpoints: [320],
	presets: {},
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: true
};

let id = '';
beforeAll(async () => {
	encodes.jpg = (await make_images()).jpg;
	id = await id_of(encodes.jpg);
});

test("the build's end waits for a file the prerender's head start is still making, and makes it once", async () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-out-'));
	const assets = path.join(out, 'client', '_app', 'immutable', 'assets');
	fs.mkdirSync(assets, { recursive: true });
	fs.copyFileSync(encodes.jpg, path.join(assets, 'h.Ab12.jpg'));
	__set_build_cache_root(path.join(out, 'cache'));
	const { handoff_for, write_built } = await import('../src/vite/build-files.ts');
	const handoff = await handoff_for(true, process.cwd(), out);

	const { default: server } = await import('../src/server.ts');
	const { mint } = await import('../src/recipe.ts');
	const { ctx } = startPlugin(server, { name: '@ogygia/image' });
	await server.request!(ctx(new Request('https://example.com/')));
	const src = '/_app/immutable/assets/h.Ab12.jpg';
	mint({ id, src, width: 64, height: 43, format: 'webp' }, false);
	await vi.waitFor(() => expect(encodes.count).toBe(1));

	const built = write_built(handoff, CFG, [], out);
	await vi.waitFor(() => expect(encodes.count).toBe(2), { timeout: 1000 }).catch(() => {});
	encodes.open();
	await built;

	expect(encodes.count).toBe(1);
	const file = path.join(out, 'client', '_app', 'immutable', 'og', `${id}-64x43.webp`);
	expect(fs.statSync(file).size).toBeGreaterThan(0);
});
