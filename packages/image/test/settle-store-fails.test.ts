import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { ENCODER_VERSION } from '../src/source-id.ts';
import { id_of, make_images } from './fixtures.ts';

const io = vi.hoisted(() => ({ file: '', id: '', reads: 0 }));
vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
});

vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/a.png': '/_app/immutable/assets/a.Ab12.png' },
	remote: []
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('$app/server', () => ({
	read: () => {
		io.reads++;
		return new Response(fs.readFileSync(io.file));
	}
}));

const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { ctx } = startPlugin(server, { name: '@ogygia/image' });

beforeAll(async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-full-'));
	const root = path.join(tmp, `ogygia-image-${process.getuid!()}`);
	const dir = path.join(root, `v${ENCODER_VERSION}-${sharp.versions.vips}`);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.chmodSync(dir, 0o500);
	process.env.TMPDIR = tmp;
	io.file = (await make_images()).small;
	io.id = await id_of(io.file);
});

test('a file the store cannot write is still answered, said once, and kept in memory instead', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const url = mint(
		{
			id: io.id,
			src: '/_app/immutable/assets/a.Ab12.png',
			width: 40,
			height: 40,
			format: 'webp'
		},
		false
	)!;
	const asks = [];
	for (let i = 0; i < 3; i++) {
		const res = (await server.request!(ctx(new Request(`http://localhost${url}`))))!;
		expect(res.status).toBe(200);
		const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
		asks.push([meta.format, meta.width]);
	}
	expect(asks).toEqual(Array(3).fill(['webp', 40]));
	expect(io.reads).toBe(1);
	expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
		expect.stringMatching(/image_store_write_failed/)
	]);
	warn.mockRestore();
});
