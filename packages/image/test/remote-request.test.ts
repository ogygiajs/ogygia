// Remote images at request: `remoteImage(url, { width, height })`, and the image endpoint that makes
// its files from the URL's bytes (src/settle.ts over src/remote-fetch.ts and src/remote-node.ts),
// against a local HTTP server (no internet). Names resolve through a fake resolver to 127.0.0.1, and
// every connection goes to the local server's port, so a host may be any name.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { clock } from '@ogygia/machine';

const io = vi.hoisted(() => ({ port: 0, address: '127.0.0.1', fail_encodes: 0 }));
vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
});

vi.mock('virtual:ogygia-image/sources', () => ({ default: {}, remote: [] }));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('$app/server', () => ({ read: () => new Response(new Uint8Array()) }));
vi.mock('virtual:ogygia-image/maker', async () => {
	const sharp_maker = await import('../src/makers/sharp.ts');
	return {
		...sharp_maker,
		make: (...args: Parameters<typeof sharp_maker.make>) => {
			if (io.fail_encodes > 0) {
				io.fail_encodes--;
				return Promise.reject(new Error('ENOMEM: out of memory'));
			}
			return sharp_maker.make(...args);
		}
	};
});
vi.mock('virtual:ogygia-image/remote', async () => {
	const { node_transport } = await import('../src/remote-node.ts');
	const get = node_transport((_host, _options, done) =>
		done(null, [{ address: io.address, family: 4 }])
	);
	return {
		remote: {
			hosts: ['http://cms.example.test', 'http://*.cdn.example.test'],
			maxBytes: 100_000,
			timeout: 400,
			maxAge: 60
		},
		transport: () =>
			Promise.resolve((url: URL, init: never, match: never) => {
				const local = new URL(url);
				local.port = String(io.port);
				return get(local, init, match);
			})
	};
});

const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { remoteImage } = await import('../src/remote-image.ts');
const { lay_out } = await import('../src/layout.ts');
const { ctx } = startPlugin(server, { name: '@ogygia/image' });

let jpg: Buffer;
let upstream: http.Server;
const asked: string[] = [];

beforeAll(async () => {
	process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-remote-req-'));
	jpg = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#3a6ea5' } })
		.jpeg()
		.toBuffer();
	upstream = http.createServer((req, res) => {
		const at = req.url ?? '/';
		asked.push(`${req.headers.host?.split(':')[0]}${at}`);
		if (at.startsWith('/photo')) {
			setTimeout(() => {
				res.writeHead(200, { 'content-type': 'image/jpeg' });
				res.end(jpg);
			}, 20);
		} else if (at === '/big.jpg') {
			res.writeHead(200, { 'content-type': 'image/jpeg' });
			res.write(jpg.subarray(0, 3));
			res.end(Buffer.alloc(200_000));
		} else if (at === '/slow.jpg' || at.startsWith('/slow-')) {
			res.writeHead(200, { 'content-type': 'image/jpeg' });
			res.write(jpg.subarray(0, 10));
		} else if (at === '/broken.jpg') {
			res.writeHead(200, { 'content-type': 'image/jpeg' });
			res.end(Buffer.concat([jpg.subarray(0, 3), Buffer.alloc(64)]));
		} else if (at === '/page.jpg') {
			res.writeHead(200, { 'content-type': 'image/jpeg' });
			res.end('<p>not an image</p>');
		} else if (at === '/away.jpg') {
			res.writeHead(302, { location: 'http://evil.example.test/photo.jpg' });
			res.end();
		} else {
			res.writeHead(500);
			res.end();
		}
	});
	await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
	io.port = (upstream.address() as AddressInfo).port;
});

afterAll(() => {
	upstream.closeAllConnections();
	upstream.close();
	vi.useRealTimers();
});

async function get(url: string): Promise<Response> {
	return (await server.request!(ctx(new Request(new URL(url, 'http://localhost')))))!;
}

/** The signed URLs `<Img>` would name for `url` at `width`, in WebP. */
function urls_of(url: string, width = 80): string[] {
	const out: string[] = [];
	lay_out(
		remoteImage(url, { width: 160, height: 90 }),
		{ width, formats: ['webp'] },
		{
			formats: ['webp'],
			breakpoints: [80, 160],
			presets: {},
			paths: { base: '', assets: '', app_dir: '_app' },
			warmed: false
		},
		(recipe) => {
			const minted = mint(recipe, false)!;
			out.push(minted);
			return minted;
		}
	);
	return out;
}

function quiet() {
	return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('the image endpoint, for a remote image', () => {
	test("a file is made from the URL's bytes, its tail the URL, answered to be kept for at most remote.maxAge, never forever", async () => {
		const [url] = urls_of('http://cms.example.test/photo-a.jpg');
		expect(url).toMatch(/^\/__ogygia__\/i\/[^/]+\/r[\w-]{32}-80x45\/\.remote\/[\w-]+\.webp$/);
		const res = await get(url!);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
		const cache = res.headers.get('cache-control')!;
		expect(cache).toMatch(/^public, max-age=(\d+), stale-while-revalidate=60$/);
		expect(Number(/max-age=(\d+)/.exec(cache)![1])).toBeLessThanOrEqual(60);
		const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['webp', 80, 45]);
	});

	test('the files of one URL asked at once share one fetch; one asked again in its window is kept, and made from a new fetch in the next window', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T00:00:05Z') });
		try {
			const [a, b] = urls_of('http://cms.example.test/photo-b.jpg', 160);
			asked.length = 0;
			const [ra, rb] = await Promise.all([get(a!), get(b!)]);
			expect([ra.status, rb.status]).toEqual([200, 200]);
			expect(asked).toEqual(['cms.example.test/photo-b.jpg']);
			expect((await get(a!)).status).toBe(200);
			expect(asked).toHaveLength(1);
			const left = Number(
				/^public, max-age=(\d+), stale-while-revalidate=60$/.exec(
					ra.headers.get('cache-control')!
				)![1]
			);
			expect(left).toBeGreaterThanOrEqual(1);
			expect(left).toBeLessThanOrEqual(60);
			vi.setSystemTime(new Date(Date.parse('2026-01-01T00:00:05Z') + left * 1000));
			const again = await get(a!);
			expect(again.status).toBe(200);
			expect(again.headers.get('cache-control')).toBe(
				'public, max-age=60, stale-while-revalidate=60'
			);
			expect(asked).toEqual(['cms.example.test/photo-b.jpg', 'cms.example.test/photo-b.jpg']);
		} finally {
			vi.useRealTimers();
		}
	});

	test("different URLs' windows end at different instants, so a server's remote files do not all expire at once", async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T00:00:00Z') });
		try {
			const ages = new Set<string | null>();
			for (const name of ['spread-a', 'spread-b', 'spread-c', 'spread-d', 'spread-e']) {
				const res = await get(urls_of(`http://cms.example.test/photo-${name}.jpg`)[0]!);
				ages.add(res.headers.get('cache-control'));
			}
			expect(ages.size).toBeGreaterThan(1);
		} finally {
			vi.useRealTimers();
		}
	});

	test('a .remote/ tail changed after signing, or the id beside it, is refused by the signature', async () => {
		const [url] = urls_of('http://cms.example.test/photo-c.jpg');
		const other = Buffer.from('http://cms.example.test/photo-d.jpg').toString('base64url');
		const forged = url!.replace(/\.remote\/[\w-]+/, `.remote/${other}`);
		const no_id = url!.replace(/\/r[\w-]{32}-/, `/r${'A'.repeat(32)}-`);
		asked.length = 0;
		for (const bad of [forged, no_id]) {
			const res = await get(bad);
			expect(res.status).toBe(403);
			expect(res.headers.get('x-ogygia-deny')).toBe('sig');
		}
		expect(asked).toEqual([]);
	});

	test('a URL on a host remote.hosts does not list is 404 and kept nowhere, though the app signed it (under an older list), and is never fetched', async () => {
		const warn = quiet();
		try {
			asked.length = 0;
			for (const url of [
				'http://evil.example.test/photo.jpg',
				'https://cms.example.test/photo.jpg',
				'http://cms.example.test:8080/photo.jpg',
				'http://cdn.example.test/photo.jpg'
			]) {
				const res = await get(urls_of(url)[0]!);
				expect(res.status, url).toBe(404);
				expect(res.headers.get('cache-control')).toBe('no-store');
			}
			expect(asked).toEqual([]);
			expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
				/image_remote_refused|answered 404/
			);
		} finally {
			warn.mockRestore();
		}
	});

	test('past maxBytes is 413, past the timeout 504, an error status or not an image 502, a redirect off the list 404: each kept nowhere, each said', async () => {
		const warn = quiet();
		try {
			const cases: [string, number, RegExp][] = [
				['/big.jpg', 413, /too large: more than remote.maxBytes, 100000 bytes/],
				['/slow.jpg', 504, /no answer within remote.timeout, 400 ms/],
				['/gone.jpg', 502, /status 500/],
				['/page.jpg', 502, /not an image: its bytes are no JPEG/],
				['/away.jpg', 404, /redirects to 'http:\/\/evil\.example\.test\/photo\.jpg'/]
			];
			for (const [at, status, said] of cases) {
				warn.mockClear();
				const res = await get(urls_of(`http://cms.example.test${at}`)[0]!);
				expect(res.status, at).toBe(status);
				expect(res.headers.get('cache-control'), at).toBe('no-store');
				expect(warn.mock.calls.map((c) => String(c[0])).join('\n'), at).toMatch(said);
			}
		} finally {
			warn.mockRestore();
		}
	});

	test('a remote URL that failed is not fetched again for a while: its files answer the remembered status, said once, and it is asked again once the memory ends', async () => {
		const warn = quiet();
		const real = clock.mono;
		const mono = vi.spyOn(clock, 'mono');
		try {
			asked.length = 0;
			const [a, b] = urls_of('http://cms.example.test/gone-again.jpg', 160);
			for (const url of [a!, b!, a!]) expect((await get(url)).status).toBe(502);
			expect(asked).toEqual(['cms.example.test/gone-again.jpg']);
			const refused = () =>
				warn.mock.calls.filter((c) => /image_remote_refused/.test(String(c[0]))).length;
			expect(refused()).toBe(1);
			mono.mockImplementation(() => real() + 60_000);
			expect((await get(a!)).status).toBe(502);
			expect(asked).toEqual(['cms.example.test/gone-again.jpg', 'cms.example.test/gone-again.jpg']);
			expect(refused()).toBe(1);
		} finally {
			mono.mockRestore();
			warn.mockRestore();
		}
	});

	test("an encode that fails on its own (out of memory under load) fails that file only: the URL's other files, and the same file asked again, are made", async () => {
		const warn = quiet();
		try {
			asked.length = 0;
			const [a, b] = urls_of('http://cms.example.test/photo-encode.jpg', 160);
			io.fail_encodes = 1;
			expect((await get(a!)).status).toBe(500);
			expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
				/image_settle_failed[\s\S]*ENOMEM/
			);
			expect((await get(b!)).status).toBe(200);
			expect((await get(a!)).status).toBe(200);
		} finally {
			io.fail_encodes = 0;
			warn.mockRestore();
		}
	});

	test("an original that does not decode is the URL's failure: every file of it answers 502, remembered, from one fetch", async () => {
		const warn = quiet();
		try {
			asked.length = 0;
			const [a, b] = urls_of('http://cms.example.test/broken.jpg', 160);
			for (const url of [a!, b!]) expect((await get(url)).status).toBe(502);
			expect(asked).toEqual(['cms.example.test/broken.jpg']);
			expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/did not decode/);
		} finally {
			warn.mockRestore();
		}
	});

	test('a host listed only by *. that resolves to a private address is never connected to; one the list names itself is', async () => {
		const warn = quiet();
		try {
			asked.length = 0;
			const below = await get(urls_of('http://img.cdn.example.test/photo-e.jpg')[0]!);
			expect(below.status).toBe(404);
			expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
				/img\.cdn\.example\.test resolves to 127\.0\.0\.1, not a public address, and is listed only by a '\*\.' entry/
			);
			expect(asked).toEqual([]);
			const named = await get(urls_of('http://cms.example.test/photo-e.jpg')[0]!);
			expect(named.status).toBe(200);
		} finally {
			warn.mockRestore();
		}
	});

	test('slow remote hosts hold no encode slot: a file whose bytes are here is made while they wait', async () => {
		const warn = quiet();
		try {
			const settled: string[] = [];
			const slow = Array.from({ length: 6 }, (_, i) =>
				get(urls_of(`http://cms.example.test/slow-${i}.jpg`)[0]!).then((r) => {
					settled.push(`slow ${r.status}`);
				})
			);
			await new Promise((done) => setTimeout(done, 50));
			const fast = await get(urls_of('http://cms.example.test/photo-fast.jpg')[0]!);
			settled.push(`fast ${fast.status}`);
			await Promise.all(slow);
			expect(settled[0]).toBe('fast 200');
		} finally {
			warn.mockRestore();
		}
	});

	test('a small remote image the CMS says is huge is never made larger than it is', async () => {
		const out: string[] = [];
		lay_out(
			remoteImage('http://cms.example.test/photo-huge.jpg', { width: 12_000, height: 12_000 }),
			{ width: 12_000, height: 12_000, formats: ['webp'] },
			{
				formats: ['webp'],
				breakpoints: [12_000],
				presets: {},
				paths: { base: '', assets: '', app_dir: '_app' },
				warmed: false
			},
			(recipe) => {
				const minted = mint(recipe, false)!;
				out.push(minted);
				return minted;
			}
		);
		const res = await get(out.find((u) => u.includes('-12000x12000'))!);
		expect(res.status).toBe(200);
		const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
		expect(meta.width).toBeLessThanOrEqual(160);
		expect(meta.height).toBeLessThanOrEqual(90);
	});
});

describe('the most pixels a file may have', () => {
	test('a declared size past the pixels one frame may have is refused by remoteImage(), and such a recipe is no recipe', async () => {
		const { parse_recipe } = await import('../src/recipe.ts');
		expect(() =>
			remoteImage('http://cms.example.test/a.jpg', { width: 99_999, height: 99_999 })
		).toThrow(/image_remote_invalid/);
		expect(parse_recipe('rAAAA-99999x99999/.remote/aHR0cDovL2EuYi9jLmpwZw.webp')).toBeNull();
		expect(parse_recipe('rAAAA-640x360/.remote/aHR0cDovL2EuYi9jLmpwZw.webp')).not.toBeNull();
	});
});
