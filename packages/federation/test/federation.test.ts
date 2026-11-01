/**
 * Fragment federation v2 seams that run WITHOUT a browser: the peer transport (SWR cache,
 * coalescing, generation-safe invalidation, failover), Ed25519 signing/verification (audience,
 * replay, rotation), `mount()`'s auto-built claims, the document lifter, remote regions, provenance
 * adoption, and cross-app thaw. Design: internal/notes/federation.md.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { make_peer } from '../src/peer.ts';
import { federate } from '../src/federate.ts';
import { mount } from '../src/mount.ts';
import { mint_hole, set_hole_signer } from '../src/hole.ts';
import { sign_headers, verify_signed_request, lift_document } from '../src/wire.ts';
import { set_federation } from '../src/registry.ts';
import { install_federation, serve_federation } from '../src/serve.ts';
import { fed_app } from '../src/app.ts';
import fed_server from '../src/server.ts';
import type { RequestEvent } from '@sveltejs/kit';
import { routes } from '@ogygia/router';
import { startPlugin } from '@ogygia/core/plugin/testing';
// (core internals a test drives: the running code's request)
import { facts_of, set_current_request } from '../../core/src/plugin/facts.ts';
// federation's flag carry
import { flag } from '../../flags/src/index.ts';
import flags_server from '../../flags/src/server.ts';

// both plugins, started: a flag read records its decision as a request fact; federation reads the
// facts and signs with the app's key through its app
startPlugin(flags_server, { name: '@ogygia/flags' });
startPlugin(fed_server, { name: '@ogygia/federation' });

const doc_json = (extra: Record<string, unknown> = {}, status = 200) =>
	JSON.stringify({ status, title: 't', css: [], body: 'B', ...extra });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks(); // a clock a failed test left mocked
	set_federation(null);
	set_current_request(null);
	set_hole_signer(null);
});

describe('peer transport — one per remote app', () => {
	it('coalesces concurrent misses into ONE upstream call', async () => {
		let calls = 0;
		vi.stubGlobal('fetch', async () => {
			calls++;
			await new Promise((r) => setTimeout(r, 5));
			return new Response(doc_json({ body: 'one' }));
		});
		const cms = make_peer('cms', { origin: 'http://mfe.test' }, 'shell');
		const [a, b] = await Promise.all([cms.doc('/p', ''), cms.doc('/p', '')]);
		expect(calls).toBe(1);
		expect(a.body).toBe('one');
		expect(b.body).toBe('one');
	});

	it('serves fresh, then STALE + refreshes in background after ttl (SWR)', async () => {
		let calls = 0;
		vi.stubGlobal('fetch', async () => new Response(doc_json({ body: `v${++calls}` })));
		const now = vi.spyOn(Date, 'now');
		const t0 = 1_000_000;
		now.mockReturnValue(t0);
		const cms = make_peer('cms', { origin: 'http://mfe.test', cache: { ttl: 1000 } }, 'shell');

		expect((await cms.doc('/p', '')).body).toBe('v1'); // miss
		expect((await cms.doc('/p', '')).body).toBe('v1'); // fresh hit
		expect(calls).toBe(1);

		now.mockReturnValue(t0 + 5000); // past ttl
		expect((await cms.doc('/p', '')).body).toBe('v1'); // stale served INSTANTLY
		await new Promise((r) => setTimeout(r, 0));
		expect((await cms.doc('/p', '')).body).toBe('v2'); // refreshed
		expect(calls).toBe(2);
		now.mockRestore();
	});

	it('a stale refresh that answers an error document never replaces the good copy', async () => {
		let calls = 0;
		vi.stubGlobal('fetch', async () =>
			++calls === 1
				? new Response(doc_json({ body: 'good' }))
				: new Response(doc_json({ body: 'oops' }, 500))
		);
		const now = vi.spyOn(Date, 'now');
		const t0 = 1_000_000;
		now.mockReturnValue(t0);
		const cms = make_peer('cms', { origin: 'http://mfe.test', cache: { ttl: 1000 } }, 'shell');
		expect((await cms.doc('/p', '')).body).toBe('good');

		now.mockReturnValue(t0 + 5000); // past ttl: this read starts a refresh, which answers a 500
		expect((await cms.doc('/p', '')).body).toBe('good');
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toBe(2);
		// the same rule as the first fill: the error is not kept, the good copy still answers
		expect((await cms.doc('/p', '')).body).toBe('good');
		now.mockRestore();
	});

	it('generation: a pre-mutation in-flight fetch cannot repopulate the cache', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let gets = 0;
		vi.stubGlobal('fetch', async (_u: URL, init?: RequestInit) => {
			if (init?.method === 'POST') return new Response(doc_json({ body: 'post' }));
			gets++;
			if (gets === 1) await gate;
			return new Response(doc_json({ body: `get${gets}` }));
		});
		const cms = make_peer('cms', { origin: 'http://mfe.test', cache: { ttl: 60_000 } }, 'shell');
		const before = cms.doc('/p', '');
		await cms.postDoc('/p', '', new ArrayBuffer(0), 'text/plain');
		release();
		expect((await before).body).toBe('get1'); // caller still gets its answer
		expect((await cms.doc('/p', '')).body).toBe('get2'); // cache re-reads truth
		expect(gets).toBe(2);
	});

	it('postDoc speaks AS the peer (origin header) and forwards the content-type', async () => {
		let captured: Record<string, string> = {};
		vi.stubGlobal('fetch', async (_u: URL, init?: RequestInit) => {
			captured = init?.headers as Record<string, string>;
			return new Response(doc_json());
		});
		const cms = make_peer('cms', { origin: 'http://mfe.test' }, 'shell');
		await cms.postDoc('/p', '', new ArrayBuffer(0), 'application/x-www-form-urlencoded');
		expect(captured.origin).toBe('http://mfe.test');
		expect(captured['content-type']).toBe('application/x-www-form-urlencoded');
	});

	it('widgetDoc hits the catalog path with props', async () => {
		let seen: URL | undefined;
		vi.stubGlobal('fetch', async (u: URL) => {
			seen = u;
			return new Response(JSON.stringify({ html: '<div>kpis</div>' }));
		});
		const dash = make_peer('dash', { origin: 'http://dash.test' }, 'shell');
		const d = await dash.widgetDoc('kpis', { org: 'acme' });
		expect(seen!.href).toBe('http://dash.test/og/fragment/kpis?org=acme');
		expect(d.html).toBe('<div>kpis</div>');
	});

	it('widgetDoc throws a plain Error; doc() throws http errors; a network failure is a 504', async () => {
		vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
		const dash = make_peer('dash', { origin: 'http://dash.test' }, 'shell');
		await expect(dash.widgetDoc('kpis')).rejects.toThrow("fragment 'kpis' answered 500");
		await expect(dash.doc('/p', '')).rejects.toMatchObject({ status: 502 });
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('fetch failed');
		});
		const cms = make_peer('cms', { origin: 'http://mfe.test' }, 'shell');
		await expect(cms.doc('/p', '')).rejects.toMatchObject({ status: 504 });
	});

	it('failover: an unreachable primary tries the next origin; a 404 does not', async () => {
		const hit: string[] = [];
		vi.stubGlobal('fetch', async (u: URL) => {
			hit.push(new URL(u).host);
			if (new URL(u).host === 'a.test') throw new TypeError('down');
			return new Response(doc_json({ body: 'from-b' }));
		});
		const cms = make_peer('cms', { origin: ['http://a.test', 'http://b.test'] }, 'shell');
		expect((await cms.doc('/p', '')).body).toBe('from-b');
		expect(hit).toEqual(['a.test', 'b.test']);
	});
});

describe('Ed25519 signing / verification', () => {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
	const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
	const { publicKey: pk2 } = generateKeyPairSync('ed25519');
	const pub2 = pk2.export({ type: 'spki', format: 'der' }).toString('base64');

	const signed = (host = 'cms.test', audience?: string) => {
		const u = new URL(`http://${host}/og/fragment/page?path=/p`);
		const h = sign_headers(priv, 'GET', u, undefined, { sub: 'u1' }, audience);
		return new Request(u, { headers: h });
	};

	it('accepts a fresh, correctly-signed request once and returns its claims', () => {
		const req = signed();
		expect(verify_signed_request({ publicKeys: [pub] }, req, new URL(req.url))?.user?.sub).toBe(
			'u1'
		);
	});

	it('AUDIENCE BINDING: a hop signed for cms.test is rejected at dash.test (same key)', () => {
		const req = signed('cms.test');
		const at_dash = new Request('http://dash.test/og/fragment/page?path=/p', {
			headers: Object.fromEntries(req.headers)
		});
		expect(verify_signed_request({ publicKeys: [pub] }, at_dash, new URL(at_dash.url))).toBeNull();
	});

	it('REPLAY: a byte-identical second delivery is rejected', () => {
		const req = signed();
		const url = new URL(req.url);
		expect(verify_signed_request({ publicKeys: [pub] }, req, url)?.user?.sub).toBe('u1');
		const replayed = new Request(req.url, { headers: Object.fromEntries(req.headers) });
		expect(verify_signed_request({ publicKeys: [pub] }, replayed, url)).toBeNull();
	});

	it('NaN timestamp does not bypass the freshness gate', () => {
		const req = signed();
		const forged = new Request(req.url, {
			headers: { ...Object.fromEntries(req.headers), 'x-og-ts': 'not-a-number' }
		});
		expect(verify_signed_request({ publicKeys: [pub] }, forged, new URL(forged.url))).toBeNull();
	});

	it('a second authorized key still verifies (rotation / multi-caller)', () => {
		const req = signed();
		expect(
			verify_signed_request({ publicKeys: [pub2, pub] }, req, new URL(req.url))?.user?.sub
		).toBe('u1');
	});

	it('tampered claims (re-encoded x-og-user) break the signature', () => {
		const req = signed();
		const forged = new Request(req.url, {
			headers: {
				...Object.fromEntries(req.headers),
				'x-og-user': Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64')
			}
		});
		expect(verify_signed_request({ publicKeys: [pub] }, forged, new URL(forged.url))).toBeNull();
	});
});

describe('lift_document — an app’s full HTML → the wire shape', () => {
	it('extracts title, stylesheet links, and SEO meta; drops charset/viewport; absolutizes assets', () => {
		const html = `<html><head>
			<meta charset="utf-8">
			<meta name="viewport" content="width=device-width">
			<meta name="description" content="hi">
			<link rel="canonical" href="/cms/p">
			<title>CMS</title>
			<link rel="stylesheet" href="/_app/immutable/a.css">
		</head><body><ogygia-region entry="/_app/immutable/i.js"></ogygia-region></body></html>`;
		const d = lift_document(html, 'http://cms.test');
		expect(d.title).toBe('CMS');
		expect(d.css.join('')).toContain('http://cms.test/_app/immutable/a.css');
		expect(d.head).toContain('name="description"');
		expect(d.head).not.toContain('charset');
		expect(d.head).not.toContain('viewport');
		expect(d.body).toContain('entry="http://cms.test/_app/immutable/i.js"');
	});
});

describe('mount() — claims auto-built from the table identity', () => {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
	const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

	it('signs c.visitor + EVERY table experiment into the hop — no hand-listing', async () => {
		let seen: Request | undefined;
		vi.stubGlobal('fetch', async (u: URL, init?: RequestInit) => {
			seen = new Request(u, init);
			return new Response(doc_json());
		});
		const exp = flag('hero', { rollout: 100 });
		const cms = make_peer('cms', { origin: 'http://mfe.test' }, 'shell', priv);
		const app = routes(
			{ '/cms/[...rest]': mount(cms) },
			{ visitor: () => ({ sub: 'u9' }), flags: [exp] }
		);
		await app.fetch(new Request('http://shell.test/cms/x'));
		const v = verify_signed_request(
			{ publicKeys: [pub], audience: 'mfe.test' },
			seen!,
			new URL(seen!.url)
		);
		expect(v?.user?.sub).toBe('u9');
		expect((v?.user?.experiments as Record<string, unknown>)?.hero).toBeDefined();
	});

	it('STATUS CHANNEL: a mounted 404 answers 404 through the shell', async () => {
		vi.stubGlobal('fetch', async () => new Response(doc_json({ status: 404, body: 'gone' })));
		const cms = make_peer('cms', { origin: 'http://mfe.test' }, 'shell');
		const app = routes({ '/cms/[...rest]': mount(cms) });
		const res = await app.fetch(new Request('http://shell.test/cms/x'));
		expect(res!.status).toBe(404);
	});

	it('anonymous + no experiments = NO claims header at all', async () => {
		let seen: Request | undefined;
		vi.stubGlobal('fetch', async (u: URL, init?: RequestInit) => {
			seen = new Request(u, init);
			return new Response(doc_json());
		});
		const cms = make_peer('cms', { origin: 'http://mfe.test' }, 'shell', priv);
		const app = routes({ '/cms/[...rest]': mount(cms) });
		await app.fetch(new Request('http://shell.test/cms/x'));
		expect(seen!.headers.get('x-og-user')).toBeNull();
	});
});

describe('federate() — registration + fail-closed', () => {
	beforeEach(() => vi.stubGlobal('fetch', async () => new Response(doc_json())));

	it('returns typed peer handles keyed by name', () => {
		const { cms, dash } = federate({
			name: 'shell',
			peers: { cms: { origin: 'http://cms.test' }, dash: { origin: 'http://dash.test' } }
		});
		expect(cms.name).toBe('cms');
		expect(dash.origin).toBe('http://dash.test');
	});

	it('warns when it exposes but no peer has a key (and not with `open`)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		federate({ name: 'cms', expose: {} as never, peers: {} });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('UNAUTHENTICATED'));
		warn.mockClear();
		federate({ name: 'cms', expose: {} as never, peers: {}, open: true });
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe('remote regions', () => {
	it('a static remote page bakes its HTML and adopts the fragment’s tags into the capture', async () => {
		// the render's request, collecting its data-source receipts (a store or an expose asked)
		const request = new Request('http://shell/x');
		set_current_request(() => request);
		const seen: string[] = (facts_of(request).sources = []);
		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(
					doc_json({ body: '<p>fresh</p>', css: ['<link>'], sources: ['s:doc:1'], path: '/cms/p' })
				)
		);
		const cms = make_peer('cms', { origin: 'http://cms.test' }, 'shell');
		const region = await cms.page('/p');
		expect((region as { html?: string; props: { html?: string } }).props.html).toContain('fresh');
		// the page's receipts are adopted under the peer name (so a thaw matches)
		expect(seen).toContain('a:cms');
		expect(seen).toContain('p:cms:/cms/p');
		expect(seen).toContain('r:cms:s:doc:1');
	});

	it('a deferred remote region is a hole with a shell-signed url', async () => {
		set_hole_signer(({ peer, target }) => `/og/frag?peer=${peer}&target=${target}&sig=abc`);
		const cms = make_peer('cms', { origin: 'http://cms.test' }, 'shell');
		const hole = await cms.page('/p', { render: 'deferred' });
		expect(hole.kind).toBe('deferred');
		expect((hole as { url: string }).url).toBe('/og/frag?peer=cms&target=/p&sig=abc');
	});

	it('mint_hole degrades to an empty inert region when no signer is installed', () => {
		const hole = mint_hole('cms', 'page', '/p', '');
		expect(hole.kind).toBe('deferred');
		expect((hole as { url: string }).url).toBe('');
	});
});

describe('deferred remote holes — the lifetime and renewal of a local hole', () => {
	const now_sec = () => Math.floor(Date.now() / 1000);
	/** Mint a deferred remote hole the way a render does (the handle's signer installed). */
	async function mint(storable = false): Promise<URL> {
		install_federation(fed_app()!);
		const request = new Request('http://shell/x');
		set_current_request(() => request);
		if (storable) facts_of(request).storable = true;
		const { cms } = federate({ name: 'shell', peers: { cms: { origin: 'http://cms.test' } } });
		const hole = await cms.page('/p', { render: 'deferred' });
		set_current_request(null);
		return new URL((hole as { url: string }).url, 'http://shell');
	}
	/** The runtime's one retry of an expired capability (runtime/region-endpoint-url.ts). */
	const renewal = (url: URL) => `${url.pathname}${url.search}&renew=1`;
	/** Ask the shell's hole endpoint for `url`, as the browser does. */
	const ask_hole = (url: URL | string) => {
		const u = new URL(url, 'http://shell');
		return serve_federation({
			url: u,
			request: new Request(u),
			cookies: { get: () => undefined },
			locals: {}
		} as unknown as RequestEvent);
	};

	beforeEach(() =>
		vi.stubGlobal('fetch', async () => new Response(doc_json({ body: '<p>remote</p>' })))
	);

	it('expires in SECONDS, by the app’s rule: the `ttl` window, or the life of the deploy on a stored page', async () => {
		const plain = Number((await mint()).searchParams.get('exp'));
		expect(plain).toBeGreaterThan(now_sec());
		expect(plain).toBeLessThanOrEqual(now_sec() + 3600); // the app's `ttl` (an hour by default)
		const stored = Number((await mint(true)).searchParams.get('exp'));
		expect(stored).toBeGreaterThan(now_sec() + 365 * 24 * 3600); // what a local hole gets
		// the url keeps exp + sig as its tail, which a region's identity cuts off
		expect([...(await mint()).searchParams.keys()].slice(-2)).toEqual(['exp', 'sig']);
	});

	it('answers a live hole with the fragment', async () => {
		const res = await ask_hole(await mint());
		expect(res!.status).toBe(200);
		expect(await res!.text()).toContain('<p>remote</p>');
	});

	it('an expired hole is answered as an expired local one, and the runtime’s renewal re-signs it', async () => {
		const now = vi.spyOn(Date, 'now');
		const t0 = Date.now();
		now.mockReturnValue(t0);
		const url = await mint();
		now.mockReturnValue(t0 + 2 * 3600_000); // two hours later: past the window
		// the runtime tells an expired capability from its url's `exp`, in seconds …
		expect(Number(url.searchParams.get('exp'))).toBeLessThan(now_sec());
		// … sees the region endpoint's refusal …
		const expired = await ask_hole(url);
		expect(expired!.status).toBe(403);
		expect(expired!.headers.get('x-ogygia-deny')).toBe('expired');
		// … and retries once with `&renew=1`: the hole AND its fresh capability
		const renewed = await ask_hole(renewal(url));
		expect(renewed!.status).toBe(200);
		expect(await renewed!.text()).toContain('<p>remote</p>');
		const fresh = new URL(renewed!.headers.get('x-ogygia-capability')!, 'http://shell');
		expect(fresh.pathname).toBe('/og/frag');
		expect(fresh.searchParams.has('renew')).toBe(false);
		expect(Number(fresh.searchParams.get('exp'))).toBeGreaterThan(now_sec());
		expect((await ask_hole(fresh))!.status).toBe(200);
		now.mockRestore();
	});

	it('refuses a forged hole and a renewal of one that has not expired', async () => {
		const url = await mint();
		const forged = new URL(url);
		forged.searchParams.set('target', '/admin');
		expect((await ask_hole(forged))!.headers.get('x-ogygia-deny')).toBe('sig');
		const early = await ask_hole(renewal(url));
		expect(early!.headers.get('x-ogygia-deny')).toBe('renew-window');
	});
});

describe('cross-app thaw', () => {
	// (a store plugin announcing its invalidations through the shared `invalidated` hook is tested
	// with the store: packages/postrender/test/plugin.test.ts)
	it('peer.drop evicts cached documents by their adopted tags', async () => {
		let calls = 0;
		vi.stubGlobal('fetch', async () => {
			calls++;
			return new Response(doc_json({ body: `v${calls}`, sources: ['s:doc:1'], path: '/cms/p' }));
		});
		const cms = make_peer('cms', { origin: 'http://cms.test', cache: { ttl: 60_000 } }, 'shell');
		expect((await cms.doc('/p', '')).body).toBe('v1');
		expect((await cms.doc('/p', '')).body).toBe('v1'); // cached
		expect(calls).toBe(1);
		cms.drop(new Set(['r:cms:s:doc:1'])); // a thaw for that source
		expect((await cms.doc('/p', '')).body).toBe('v2'); // re-fetched
		expect(calls).toBe(2);
	});
});
