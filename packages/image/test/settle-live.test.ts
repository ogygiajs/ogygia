import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { id_of, make_images } from './fixtures.ts';

const io = vi.hoisted(() => ({ file: '', id: '', reads: 0, slow: false }));
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
		const bytes = fs.readFileSync(io.file);
		if (!io.slow) return new Response(bytes);
		return new Response(
			new ReadableStream({
				start: (c) =>
					void setTimeout(() => {
						c.enqueue(bytes);
						c.close();
					}, 100)
			})
		);
	}
}));

const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { ctx } = startPlugin(server, { name: '@ogygia/image' });

async function get(url: string): Promise<Response> {
	return (await server.request!(ctx(new Request(new URL(url, 'http://localhost')))))!;
}

const url_at = (width: number): string =>
	mint(
		{
			id: io.id,
			src: '/_app/immutable/assets/a.Ab12.png',
			width,
			height: width,
			format: 'webp'
		},
		false
	)!;

beforeAll(async () => {
	process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-live-'));
	io.file = (await make_images()).small;
	io.id = await id_of(io.file);
});

test('a signed URL asked with a query string is sent to the bare URL, and nothing is made', async () => {
	const url = url_at(40);
	for (const q of ['?1', '?v=2&x=y']) {
		const res = await get(`${url}${q}`);
		expect(res.status).toBe(308);
		expect(res.headers.get('location')).toBe(url);
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
	}
	expect(io.reads).toBe(0);
});

test('an unsigned URL with a query string is still refused', async () => {
	const url = url_at(40).replace('-40x40/', '-41x41/');
	expect((await get(`${url}?1`)).status).toBe(403);
});

test('many asks for one file at once make it once', async () => {
	const before = io.reads;
	const all = await Promise.all(Array.from({ length: 20 }, () => get(url_at(50))));
	expect(all.map((r) => r.status)).toEqual(Array(20).fill(200));
	expect(io.reads - before).toBe(1);
});

test('more files asked at once than the server queues answer 503 with a retry-after, said once', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	io.slow = true;
	const all = await Promise.all(Array.from({ length: 120 }, (_, i) => get(url_at(60 + i))));
	const busy = all.filter((r) => r.status === 503);
	expect(busy.length).toBeGreaterThan(0);
	expect(all.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(64);
	for (const r of busy) {
		expect(r.headers.get('retry-after')).toMatch(/^\d+$/);
		expect(r.headers.get('cache-control')).toBe('no-store');
	}
	expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/image_busy/)]);
	warn.mockRestore();
});

test('a second full line, after the first one emptied, is said again', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	io.slow = true;
	await get(url_at(300));
	await Promise.all(Array.from({ length: 120 }, (_, i) => get(url_at(400 + i))));
	expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/image_busy/)]);
	warn.mockRestore();
});
