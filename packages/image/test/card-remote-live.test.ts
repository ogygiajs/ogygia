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

const io = vi.hoisted(() => ({ address: '127.0.0.1', port: 0, mark: Buffer.alloc(0) }));
const MONO = createRequire(import.meta.url).resolve(
	'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'
);
const specs = vi.hoisted(() => {
	const of = (card: string, markup: string): CardSpec => ({
		card,
		file: 'src/lib/Card.svelte',
		digest: `d-${process.pid}-${Date.now()}`,
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
			const spec = name === specs.remote.card ? specs.remote : specs.plain;
			return Promise.resolve({
				spec,
				png: (props: CardProps, fonts: readonly ArrayBuffer[], images: never, fit: never) =>
					card_png(spec, props, fonts, images, fit)
			});
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
	upstream = http.createServer((_req, res) => {
		res.writeHead(200, { 'content-type': 'image/png', 'content-length': io.mark.byteLength });
		res.end(io.mark);
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

test('a live card that shows only the build’s images stays immutable', async () => {
	const res = await get(card(specs.plain)({}).src);
	expect(res.status).toBe(200);
	expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
});
