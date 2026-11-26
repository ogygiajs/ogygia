// A live card at the image endpoint: an image its markup names is fetched through the endpoint's
// remote guard, and a failure there keeps the status the endpoint gives that failure anywhere (a
// remote host's refusal its 502/504/413, a full line its 503), never a 500 for the card.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import type { CardProps } from '../src/card.ts';

const io = vi.hoisted(() => ({ address: '127.0.0.1', port: 0 }));
const MONO = createRequire(import.meta.url).resolve(
	'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'
);
const spec = vi.hoisted(() => ({
	card: 'EndpointCard0000',
	file: 'src/lib/Card.svelte',
	digest: 'd1',
	width: 600,
	height: 315,
	fonts: [{ name: 'JetBrains Mono', weight: 500, style: 'normal' as const, src: '/font.woff' }],
	html: (props: CardProps) =>
		Promise.resolve(
			`<div style="display: flex; width: 600px; height: 315px"><img src="${String(props.src)}" width="10" height="10"></div>`
		)
}));

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
		card_module: () =>
			Promise.resolve({
				spec,
				png: (props: CardProps, fonts: readonly ArrayBuffer[], images: never) =>
					card_png(spec, props, fonts, images)
			})
	};
});
vi.mock('virtual:ogygia-image/remote', async () => {
	const { node_transport } = await import('../src/remote-node.ts');
	const get = node_transport((_host, _options, done) =>
		done(null, [{ address: io.address, family: 4 }])
	);
	return {
		remote: { hosts: ['http://cms.example.test'], maxBytes: 100_000, timeout: 400, maxAge: 60 },
		transport: () =>
			Promise.resolve((url: URL, init: never, match: never) => {
				const local = new URL(url);
				local.port = String(io.port);
				return get(local, init, match);
			})
	};
});

const { default: server } = await import('../src/server.ts');
const { card } = await import('../src/card.ts');
const { ctx } = startPlugin(server, { name: '@ogygia/image' });

let upstream: http.Server;

beforeAll(async () => {
	process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-card-endpoint-'));
	upstream = http.createServer((req, res) => {
		if (req.url === '/slow.png') {
			res.writeHead(200, { 'content-type': 'image/png' });
			res.write(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'));
			return;
		}
		res.writeHead(500);
		res.end();
	});
	await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
	io.port = (upstream.address() as AddressInfo).port;
});

afterAll(() => {
	upstream.closeAllConnections();
	upstream.close();
});

async function get(url: string): Promise<Response> {
	return (await server.request!(ctx(new Request(new URL(url, 'http://localhost')))))!;
}

test("a live card whose image the remote host refuses answers the remote's status, not a 500 for the card", async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const gone = await get(card(spec)({ src: 'http://cms.example.test/gone.png' }).src);
		expect(gone.status).toBe(502);
		expect(gone.headers.get('cache-control')).toBe('no-store');
		const slow = await get(card(spec)({ src: 'http://cms.example.test/slow.png' }).src);
		expect(slow.status).toBe(504);
		const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
		expect(said).toMatch(/image_remote_refused/);
		expect(said).not.toMatch(/image_settle_failed|image_card_source/);
	} finally {
		warn.mockRestore();
	}
});
