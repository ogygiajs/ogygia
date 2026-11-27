// A live card that shows a remote image is a file made from a remote URL's bytes: kept, and sent to
// be kept, for `remote.maxAge`, never forever, so the host's new picture reaches it; a card that
// shows only the build's images stays immutable.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { clock } from '@ogygia/machine';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import type { CardProps, CardSpec } from '../src/card.ts';

const io = vi.hoisted(() => ({
	address: '127.0.0.1',
	port: 0,
	mark: Buffer.alloc(0) as Buffer,
	no_store: false,
	asked: [] as string[]
}));
const MONO = createRequire(import.meta.url).resolve(
	'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'
);
const specs = vi.hoisted(() => {
	const of = (card: string, markup: string): CardSpec => ({
		card,
		file: 'src/lib/Card.svelte',
		digest: `${card}-${process.pid}-${Date.now()}`,
		width: 600,
		height: 315,
		fonts: [{ name: 'JetBrains Mono', weight: 500, style: 'normal', src: '/font.woff' }],
		html: () =>
			Promise.resolve(
				`<div style="display: flex; width: 600px; height: 315px; background-color: #00ff00">${markup}</div>`
			)
	});
	return {
		remote: of(
			'RemoteMarkCard00',
			'<img src="http://cms.example.test/mark.png" style="width: 300px; height: 300px">'
		),
		broken: of(
			'BrokenMarkCard00',
			'<img src="http://cms.example.test/broken.png" style="width: 300px; height: 300px">'
		),
		plain: of('PlainCard0000000', '<p>Hello</p>')
	};
});

vi.mock('virtual:ogygia-image/sources', () => ({ default: {}, remote: [] }));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('$app/server', () => ({
	read: () => new Response(new Uint8Array(fs.readFileSync(MONO)))
}));
vi.mock('virtual:ogygia-image/cards', async () => {
	const { card_png } = await import('../src/cards/engine.ts');
	return {
		engine: true,
		card_module: (name: string) => {
			const spec = Object.values(specs).find((s) => s.card === name) ?? specs.plain;
			return Promise.resolve({
				spec,
				png: (props: CardProps, fonts: readonly ArrayBuffer[], images: never, fit: never) =>
					card_png(spec, props, fonts, images, fit)
			});
		}
	};
});
vi.mock('virtual:ogygia-image/maker', async () => {
	const sharp_maker = await import('../src/makers/sharp.ts');
	return {
		...sharp_maker,
		get store() {
			return io.no_store ? null : sharp_maker.store;
		}
	};
});
vi.mock('virtual:ogygia-image/remote', async () => {
	const { node_transport } = await import('../src/remote-node.ts');
	const get = node_transport((_host, _options, done) =>
		done(null, [{ address: io.address, family: 4 }])
	);
	return {
		remote: { hosts: ['http://cms.example.test'], maxBytes: 1_000_000, timeout: 2000, maxAge: 60 },
		transport: () =>
			Promise.resolve((url: URL, init: never, match: never) => {
				const local = new URL(url);
				local.port = String(io.port);
				return get(local, init, match);
			})
	};
});

const solid = (background: string): Promise<Buffer> =>
	sharp({ create: { width: 300, height: 300, channels: 3, background } })
		.png()
		.toBuffer();

let upstream: http.Server;
let server: (typeof import('../src/server.ts'))['default'];
let card: (typeof import('../src/card.ts'))['card'];
let ctx: (req: Request) => never;

beforeAll(async () => {
	process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-card-remote-'));
	({ default: server } = await import('../src/server.ts'));
	({ card } = await import('../src/card.ts'));
	({ ctx } = startPlugin(server, { name: '@ogygia/image' }) as never);
	io.mark = await solid('#ff0000');
	upstream = http.createServer((req, res) => {
		io.asked.push(req.url ?? '/');
		const body =
			req.url === '/broken.png'
				? Buffer.concat([io.mark.subarray(0, 8), Buffer.alloc(200, 7)])
				: io.mark;
		res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.byteLength });
		res.end(body);
	});
	await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
	io.port = (upstream.address() as AddressInfo).port;
});

afterAll(() => {
	upstream.closeAllConnections();
	upstream.close();
	vi.restoreAllMocks();
});

async function get(url: string): Promise<Response> {
	return (await server.request!(ctx(new Request(new URL(url, 'http://localhost')))))!;
}

async function pixel(res: Response): Promise<number[]> {
	const { data } = await sharp(Buffer.from(await res.arrayBuffer()))
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const at = (100 * 600 + 100) * 3;
	return [...data.subarray(at, at + 3)];
}

test("a live card that shows a remote image is never sent immutable: it is kept for remote.maxAge, and past it the host's new picture is drawn", async () => {
	const src = card(specs.remote)({}).src;
	const first = await get(src);
	expect(first.status).toBe(200);
	const keep = first.headers.get('cache-control')!;
	expect(keep).not.toMatch(/immutable/);
	expect(keep).toMatch(/^public, max-age=\d+, stale-while-revalidate=60$/);
	expect(await pixel(first)).toEqual([255, 0, 0]);
	io.mark = await solid('#0000ff');
	const now = clock.wall();
	vi.spyOn(clock, 'wall').mockImplementation(() => now + 121_000);
	const later = await get(src);
	expect(later.status).toBe(200);
	expect(await pixel(later)).toEqual([0, 0, 255]);
});

test('a live card that shows a remote image, kept in memory (no store), is sent with what is left of its window, not its first ask’s max-age', async () => {
	io.no_store = true;
	try {
		const now = Math.floor(clock.wall() / 1000) * 1000;
		const wall = vi.spyOn(clock, 'wall').mockImplementation(() => now);
		let src = '';
		let left = 0;
		for (let n = 0; left < 2; n++) {
			src = card(specs.remote)({ memory: n }).src;
			const first = await get(src);
			expect(first.status).toBe(200);
			left = Number(/max-age=(\d+)/.exec(first.headers.get('cache-control')!)![1]);
		}
		wall.mockImplementation(() => now + (left - 1) * 1000);
		const later = await get(src);
		expect(later.status).toBe(200);
		expect(later.headers.get('cache-control')).toBe('public, max-age=1, stale-while-revalidate=60');
	} finally {
		io.no_store = false;
	}
});

test('a live card whose remote image does not decode is that URL’s failure, as for remoteImage(): 502, remembered (one fetch), said once', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		io.asked.length = 0;
		const src = card(specs.broken)({}).src;
		const statuses = [];
		for (let i = 0; i < 3; i++) statuses.push((await get(src)).status);
		expect(statuses).toEqual([502, 502, 502]);
		expect(io.asked).toEqual(['/broken.png']);
		const said = warn.mock.calls.map((c) => String(c[0]));
		expect(said.filter((line) => /image_remote_refused/.test(line))).toHaveLength(1);
		expect(said.join('\n')).toMatch(/did not decode/);
		expect(said.join('\n')).not.toMatch(/image_settle_failed/);
	} finally {
		warn.mockRestore();
	}
});

test('a live card that shows only the build’s images stays immutable', async () => {
	const res = await get(card(specs.plain)({}).src);
	expect(res.status).toBe(200);
	expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
});
