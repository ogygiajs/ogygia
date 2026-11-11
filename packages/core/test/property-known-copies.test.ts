// SERVER-DELTA NAV: an SPA nav names the region copies the browser holds live (`x-ogygia-known`, one
// fingerprint per copy), and the server skips a region only while a named copy is left
// (server/region-endpoint.ts `reuse_known_region`). The header is the browser's claim: whatever it
// says, the server never skips more copies of a fingerprint than the header names, never more than
// the page renders, never one it does not name, and never on a request that is not an SPA nav.
import { afterEach, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import { reuse_known_region } from '../src/server/region-endpoint.ts';

afterEach(() => set_request_event_stub(null));

const FPS = ['a', 'b', 'c', 'd'];
const fp = fc.constantFrom(...FPS);
/** a header value: named copies, sometimes with noise (empty entries, other fingerprints) */
const header = fc.array(fc.oneof(fp, fp, fc.constantFrom('', ' a', 'zz', 'a,b')), {
	maxLength: 12
});

/** Stand up a request; returns the header as the server reads it (Headers trims its edges). */
function request(headers: Record<string, string>): string {
	const event = { request: new Request('https://example.com/', { headers }) };
	set_request_event_stub(() => event);
	return event.request.headers.get('x-ogygia-known') ?? '';
}
const count = (list: string[], x: string) => list.filter((y) => y === x).length;

it('skips each fingerprint at most as many times as the header names it and the page renders it', () => {
	fc.assert(
		fc.property(header, fc.array(fp, { maxLength: 16 }), (named, renders) => {
			const known = request({ 'x-ogygia-spa': '1', 'x-ogygia-known': named.join(',') });
			const skipped = new Map<string, number>();
			for (const f of renders) {
				if (reuse_known_region(f)) skipped.set(f, (skipped.get(f) ?? 0) + 1);
			}
			const parts = known.split(',');
			for (const f of FPS) {
				expect(skipped.get(f) ?? 0, f).toBe(Math.min(count(parts, f), count(renders, f)));
			}
		}),
		{ numRuns: 300 }
	);
});

it('skips nothing on a request that is not an SPA nav, whatever it names', () => {
	fc.assert(
		fc.property(header, fc.array(fp, { maxLength: 8 }), (named, renders) => {
			request({ 'x-ogygia-known': named.join(',') });
			for (const f of renders) expect(reuse_known_region(f)).toBe(false);
		}),
		{ numRuns: 100 }
	);
});

it('skips nothing off a request (prerender)', () => {
	set_request_event_stub(null);
	for (const f of FPS) expect(reuse_known_region(f)).toBe(false);
});
