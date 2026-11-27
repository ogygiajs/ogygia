// With `kit.paths.assets` set to a CDN, the endpoint reads each original with Kit's `read()`, which
// cuts the assets prefix off the string it is given: the string must be the one the SSR import gave.
import fs from 'node:fs';
import sharp from 'sharp';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { id_of, make_images } from './fixtures.ts';

const ASSETS = 'https://cdn.example.com';
const files = vi.hoisted(() => new Map<string, string>());
vi.hoisted(() => {
	const dir = `${process.env.TMPDIR ?? '/tmp'}/og-image-assets-test-${process.pid}-${Date.now()}`;
	process.env.__OGYGIA_IMAGE_BUILD = JSON.stringify({ store: dir, minted: `${dir}.minted` });
});

vi.mock('virtual:ogygia-image/sources', () => ({
	default: {
		'/src/lib/harbor.jpg': 'https://cdn.example.com/_app/immutable/assets/harbor.Ab12.jpg'
	},
	remote: []
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '/docs', assets: 'https://cdn.example.com', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('$app/server', () => ({
	read: (asset: string) => {
		const file = files.get(decodeURIComponent(asset.slice('https://cdn.example.com'.length + 1)));
		if (!file) throw new Error(`Asset does not exist: ${asset}`);
		return new Response(fs.readFileSync(file));
	}
}));

const { default: server } = await import('../src/server.ts');
const { mint, set_minter } = await import('../src/recipe.ts');

set_minter(null);
const { ctx } = startPlugin(server, { name: '@ogygia/image' });
let id = '';

beforeAll(async () => {
	const img = await make_images();
	files.set('_app/immutable/assets/harbor.Ab12.jpg', img.jpg);
	id = await id_of(img.jpg);
});

describe('paths.assets', () => {
	test('with paths.assets set to a CDN, a signed file is made from the original Kit serves there', async () => {
		const url = mint(
			{
				id,
				src: `${ASSETS}/_app/immutable/assets/harbor.Ab12.jpg`,
				width: 160,
				height: 120,
				format: 'webp'
			},
			false
		)!;
		expect(url.startsWith('/docs/__ogygia__/i/')).toBe(true);
		const res = (await server.request!(ctx(new Request(new URL(url, 'http://localhost')))))!;
		expect(res.status).toBe(200);
		const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['webp', 160, 120]);
	});
});
