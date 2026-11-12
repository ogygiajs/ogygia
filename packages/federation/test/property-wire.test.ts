// Properties of what a federation receiver reads from a peer, over generated inputs rather than
// picked ones:
// - signed visitor claims read back as the caller sent them; one header the signature covers changed
//   in any way (the signature's spelling too: #706) is refused (null), never a throw;
// - a peer document's island graph (as core writes one), pinned to the peer's origin, stays JSON with
//   no `<` (it can never close its script); any graph text pins without a throw, and twice is once.
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { fc } from '@ogygia/config/sim';
import { absolutize, sign_headers, verify_signed_request } from '../src/wire.ts';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const url = new URL('http://cms.test/og/fragment/page?path=/p');
// (the receiver's own audience: never the request's Host)
const cfg = { publicKeys: [pub], audience: url.host };

const claims = fc.dictionary(
	fc.string().filter((k) => k !== '__proto__'),
	fc.jsonValue(),
	{ maxKeys: 5 }
);

describe('signed claims', () => {
	it('read back as sent', () => {
		fc.assert(
			fc.property(claims, (c) => {
				const req = new Request(url, { headers: sign_headers(priv, 'GET', url, undefined, c) });
				const got = verify_signed_request(cfg, req, url);
				// (as JSON carries them: -0 reads back as 0)
				expect(got?.user).toEqual(JSON.parse(JSON.stringify(c)));
			}),
			{ numRuns: 300 }
		);
	});

	// A call with the capability is checked by it alone (the legacy headers ride along for a peer that
	// does not read it yet): what it covers is the capability and the claims. A call with the legacy
	// signature alone: every one of its headers.
	it.each([
		['with the capability', (h: Record<string, string>) => h, ['x-og-cap', 'x-og-user']],
		[
			'with the legacy signature alone',
			({ 'x-og-cap': _cap, ...legacy }: Record<string, string>) => legacy,
			null
		]
	] as const)(
		'%s: one header it covers changed in any way is refused, never a throw',
		(_, sent, covered) => {
			fc.assert(
				fc.property(
					claims,
					fc.nat(),
					fc.nat(),
					fc.string({ minLength: 1, maxLength: 3 }),
					(c, which, at, put) => {
						const h = sent(sign_headers(priv, 'GET', url, undefined, c));
						const names = Object.keys(h).filter(
							(n) => covered === null || (covered as readonly string[]).includes(n)
						);
						const name = names[which % names.length]!;
						const value = h[name]!;
						const i = at % (value.length + 1);
						const changed = value.slice(0, i) + put + value.slice(i + 1);
						fc.pre(changed !== value);
						const headers = new Headers();
						for (const [k, v] of Object.entries({ ...h, [name]: changed })) {
							try {
								headers.set(k, v);
							} catch {
								fc.pre(false); // (not a value a header can carry)
							}
						}
						// (a header value is trimmed: a space put at either end changes nothing)
						fc.pre(headers.get(name) !== value);
						const req = new Request(url, { headers });
						expect(verify_signed_request(cfg, req, url)).toBeNull();
					}
				),
				{ numRuns: 500 }
			);
		}
	);
});

const graph_open = '<script type="application/json" data-ogygia-graph>';
/** The graph scripts' text in `html`. */
const graphs_of = (html: string) =>
	[...html.matchAll(/data-ogygia-graph>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);

describe('a peer document', () => {
	const asset = fc.oneof(
		fc.string({ maxLength: 8 }),
		fc.constantFrom('/_app/x.js', 'og/y.css', 'https://cdn.test/z.js', '</script>', '<!--', 'a<b')
	);
	const graph = fc.record(
		{
			h: fc.array(asset, { maxLength: 4 }),
			e: fc.dictionary(asset, fc.array(fc.nat(5), { maxLength: 3 }), { maxKeys: 3 }),
			s: fc.dictionary(asset, asset, { maxKeys: 3 })
		},
		{ requiredKeys: [] }
	);

	it('its pinned island graph is JSON with no <', () => {
		fc.assert(
			fc.property(graph, (g) => {
				const text = JSON.stringify(g).replaceAll('<', '\\u003C');
				const once = absolutize(`<p>x</p>${graph_open}${text}</script>`, 'https://peer.test');
				const [pinned] = graphs_of(once);
				expect(pinned).not.toContain('<');
				expect(Object.keys(JSON.parse(pinned!)).sort()).toEqual(Object.keys(g).sort());
			}),
			{ numRuns: 1000 }
		);
	});

	it('any graph text is pinned without a throw, and pinning twice is pinning once', () => {
		fc.assert(
			fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
				fc.pre(!text.includes('</script'));
				const once = absolutize(`<p>x</p>${graph_open}${text}</script>`, 'https://peer.test');
				expect(absolutize(once, 'https://peer.test')).toBe(once);
			}),
			{ numRuns: 1000 }
		);
	});
});
