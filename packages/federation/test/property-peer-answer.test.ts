// A peer's answer that is JSON but not its document's shape is a failed hop, said with a code, the
// same as one that does not parse (#929, #1103): a static widget shows the boundary card, a page read
// is an HttpError (502), never a TypeError that turns the shell's page into a 500.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@ogygia/router';
import { fc } from '@ogygia/config/sim';
import { PeerHandle } from '../src/peer.ts';
import { set_federation } from '../src/registry.ts';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
});

function peer(answer: string) {
	vi.stubGlobal('fetch', async () => new Response(answer, { status: 200 }));
	const warned: string[] = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warned.push(a.join(' ')));
	return { dash: new PeerHandle('dash', { origin: 'https://dash.example' }, 'shell'), warned };
}

const said = (warned: string[]) => warned.some((w) => w.includes('federation_peer_answer_invalid'));

/** Any JSON, and documents with each field of any JSON type: the shapes a proxy or a broken peer
 *  can answer with. */
const FIELDS = [
	'status',
	'location',
	'title',
	'css',
	'head',
	'body',
	'html',
	'runtime',
	'path',
	'sources',
	'trace',
	'server_ms'
];
const answer = fc.oneof(
	fc.jsonValue({ maxDepth: 3 }),
	fc.dictionary(fc.constantFrom(...FIELDS), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 6 }),
	fc.record(
		{ status: fc.constant(200), body: fc.string(), html: fc.string() },
		{ requiredKeys: [] }
	)
);

const NOTHING_SAID = [
	'null',
	'{}',
	'{"error":"busy"}',
	'{"html":5}',
	'{"css":"x","body":"b"}',
	'{"status":200,"title":"t","css":[],"body":"b","trace":{"trace_id":"a\\r\\nb","span_id":"c"}}'
];

describe('a peer answer that is JSON but not its document', () => {
	it.each(NOTHING_SAID)(
		'%s: a widget shows the card, a page read is a 502, and the code is said',
		async (a) => {
			const { dash, warned } = peer(a);
			const region = (await dash.widget('kpis')) as { html: string };
			expect(region.html).toContain('data-og-fragment-failed');
			const e = await dash.doc('/p', '').catch((err: unknown) => err);
			expect(isHttpError(e) && e.status).toBe(502);
			expect(said(warned)).toBe(true);
		}
	);

	it('any answer: a widget is a region, a page read a document or an HttpError, never a TypeError', async () => {
		await fc.assert(
			fc.asyncProperty(answer, async (a) => {
				const { dash } = peer(JSON.stringify(a));
				const region = (await dash.widget('kpis')) as { html: unknown };
				expect(typeof region.html).toBe('string');
				const doc = await dash.doc('/p', '').catch((err: unknown) => err);
				if (isHttpError(doc)) return;
				const d = doc as { body: unknown; status: unknown; css?: unknown };
				expect(typeof d.body).toBe('string');
				expect(Number.isInteger(d.status)).toBe(true);
				expect(d.css === undefined || Array.isArray(d.css)).toBe(true);
			}),
			{ numRuns: 300 }
		);
	});
});
