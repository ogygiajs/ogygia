// Fragment federation on the wire: lifting a remote app's full document into the fragment shape
// (head channel, stylesheets, body and island graph pinned to the remote's origin), and the signed
// hop: signing a request, and verifying it against the keys in rotation with the replay guard
// holding a busy minute's signatures.
import { generateKeyPairSync } from 'node:crypto';
import { bench } from '@bench/heisenbench/bench';
import {
	absolutize,
	lift_document,
	sign_headers,
	verify_signed_request,
	__heisenbench as wire
} from '../src/wire.ts';

const ORIGIN = 'https://cms.example.test';

/** A remote app's rendered page: head hints and meta, `regions` islands, the island graph script. */
function remote_document(regions: number): string {
	let head = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width">';
	head +=
		'<meta name="description" content="Catalog"><meta property="og:image" content="/img/og.png">';
	head += '<link rel="canonical" href="/catalog"><title>Catalog</title>';
	for (let i = 0; i < 12; i++)
		head += `<link rel="stylesheet" href="/_app/immutable/assets/s${i}.css">`;
	head += '<style>.x{color:red}</style>';
	head +=
		'<script type="module" data-ogygia-runtime src="/_app/ogygia/runtime.js"></script></head>';
	const graph: { h: string[]; e: Record<string, number[]>; s: Record<string, string> } = {
		h: [],
		e: {},
		s: {}
	};
	for (let c = 0; c < 30; c++) graph.h.push(`/_app/immutable/chunks/c${c}.js`);
	let body = '<body><div style="display: contents">';
	for (let i = 0; i < regions; i++) {
		const entry = `/_app/ogygia/og-region.${(i * 2654435761).toString(16).slice(0, 12)}.js`;
		graph.e[entry] = [i % 30, (i * 7) % 30, (i * 13) % 30];
		if (i % 10 === 0) graph.s[entry] = `/_app/immutable/og-region.${i}.X1.js`;
		body +=
			`<ogygia-region entry="${entry}" wake="visible"><article><img src="/img/${i}.webp" alt="">` +
			`<a href="/catalog/${i}">Item ${i}</a><p>${'Lorem ipsum dolor sit amet. '.repeat(8)}</p></article></ogygia-region>`;
	}
	body += `<script type="application/json" data-ogygia-graph>${JSON.stringify(graph)}</script></div></body>`;
	return `<!doctype html><html lang="en">${head}${body}</html>`;
}

function keys(): { pub: string; priv: string } {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	return {
		pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
		priv: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
	};
}

bench(
	'lift_document: a remote page into the fragment shape',
	({ html }) => lift_document(html, ORIGIN).body.length,
	{
		setup: () => ({ html: remote_document(150) }),
		scale: (_ctx, k) => ({ html: remote_document(150 * k) })
	}
);

bench(
	'absolutize: a widget body with its island graph',
	({ html }) => absolutize(html, ORIGIN).length,
	{
		setup: () => {
			const doc = remote_document(60);
			return { html: doc.slice(doc.indexOf('<body>')) };
		}
	}
);

/** The replay guard after a busy minute: `expired` signatures past their window, then live ones. */
function fill_replay_guard(expired: number): void {
	wire.seen_sigs.clear();
	for (let i = 0; i < expired; i++) wire.seen_sigs.set(`old-${i}`, 1);
	for (let i = 0; i < 200; i++) wire.seen_sigs.set(`live-${i}`, Number.MAX_SAFE_INTEGER);
}

bench(
	'signed hop: sign, then verify against three keys in rotation and sweep the replay guard',
	({ signer, cfg, body }) => {
		const url = new URL('https://shell.example.test/og/fragment/page?path=%2Fcatalog');
		const headers = sign_headers(signer, 'POST', url, body, { sub: 'visitor-1', plan: 'pro' });
		const request = new Request(url, { method: 'POST', headers });
		return verify_signed_request(cfg, request, url, body);
	},
	{
		setup: () => {
			const rotation = [keys(), keys(), keys()];
			fill_replay_guard(1000);
			return {
				signer: rotation[2].priv,
				cfg: { publicKeys: rotation.map((k) => k.pub), audience: 'shell.example.test' },
				body: new TextEncoder().encode(JSON.stringify({ q: 'catalog', page: 2 }))
			};
		},
		scale: (ctx, k) => {
			fill_replay_guard(1000 * k);
			return ctx;
		},
		teardown: () => wire.seen_sigs.clear()
	}
);

bench(
	'signed hop from a peer on the legacy headers only: verify against three keys in rotation',
	({ cfg, body, headers, url }) =>
		verify_signed_request(cfg, new Request(url, { method: 'POST', headers }), url, body),
	{
		setup: () => {
			const rotation = [keys(), keys(), keys()];
			fill_replay_guard(1000);
			const url = new URL('https://shell.example.test/og/fragment/page?path=%2Fcatalog');
			const body = new TextEncoder().encode(JSON.stringify({ q: 'catalog', page: 2 }));
			const headers = sign_headers(rotation[2].priv, 'POST', url, body, { sub: 'visitor-1' });
			delete headers['x-og-cap'];
			return {
				cfg: { publicKeys: rotation.map((k) => k.pub), audience: 'shell.example.test' },
				body,
				headers,
				url
			};
		},
		teardown: () => wire.seen_sigs.clear()
	}
);
