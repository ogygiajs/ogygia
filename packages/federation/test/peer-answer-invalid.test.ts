// A peer's answer that is not the JSON document it should be (a byte tampered on the way, a proxy's
// HTML error page) is a failed hop, said with a code: never an unhandled SyntaxError that turns the
// shell's whole page into a 500. A static widget shows the boundary card in its place, a page read
// or a mutation is a 502 (the upstream answered no document), and a deferred hole answers empty.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@ogygia/router';
import { PeerHandle } from '../src/peer.ts';
import { set_federation } from '../src/registry.ts';

const BROKEN = '{"html":"<p>kpis</p>",'; // one byte short of a document

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
});

function peer(answer: string, status = 200) {
	vi.stubGlobal('fetch', async () => new Response(answer, { status }));
	const warned: string[] = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warned.push(a.join(' ')));
	return { dash: new PeerHandle('dash', { origin: 'https://dash.example' }, 'shell'), warned };
}

const said = (warned: string[]) => warned.some((w) => w.includes('federation_peer_answer_invalid'));

describe("a peer's answer that is not its JSON document", () => {
	it('a static widget: the boundary card in its place, and the code said', async () => {
		const { dash, warned } = peer(BROKEN);
		const region = (await dash.widget('kpis')) as { html: string };
		expect(region.html).toContain('data-og-fragment-failed');
		expect(said(warned)).toBe(true);
	});

	it('a page read: a 502 the page handles, and the code said', async () => {
		const { dash, warned } = peer(BROKEN);
		const e = await dash.doc('/p', '').catch((err: unknown) => err);
		expect(isHttpError(e) && e.status).toBe(502);
		expect(said(warned)).toBe(true);
	});

	it('a mutation: a 502, and the code said', async () => {
		const { dash, warned } = peer('<!doctype html><p>proxy error</p>');
		const e = await dash
			.postDoc('/p', '', new ArrayBuffer(0), 'text/plain')
			.catch((err: unknown) => err);
		expect(isHttpError(e) && e.status).toBe(502);
		expect(said(warned)).toBe(true);
	});

	it('the raw widget document: a plain Error naming the code, not a SyntaxError', async () => {
		const { dash } = peer(BROKEN);
		const e = await dash.widgetDoc('kpis').catch((err: unknown) => err);
		expect(e).toBeInstanceOf(Error);
		expect(e).not.toBeInstanceOf(SyntaxError);
	});
});

// An error status is an answer that can't be used either (#931): the same reader says it with the
// same code. A static widget's error status used to throw out of the shell's load: a 500 page.
describe("a peer's answer with an error status", () => {
	it('a static widget whose peer answers 500: the boundary card in its place, and the code said', async () => {
		const { dash, warned } = peer('upstream down', 500);
		const region = (await dash.widget('kpis')) as { html: string };
		expect(region.html).toContain('data-og-fragment-failed');
		expect(said(warned)).toBe(true);
	});

	it('a static widget the peer does not have (404): the boundary card, and the code said', async () => {
		const { dash, warned } = peer('not found', 404);
		const region = (await dash.widget('nope')) as { html: string };
		expect(region.html).toContain('data-og-fragment-failed');
		expect(said(warned)).toBe(true);
	});

	it('a page read whose peer answers 500: a 502, and the code said', async () => {
		const { dash, warned } = peer('upstream down', 500);
		const e = await dash.doc('/p', '').catch((err: unknown) => err);
		expect(isHttpError(e) && e.status).toBe(502);
		expect(said(warned)).toBe(true);
	});

	it('a page read whose peer is unavailable (503): the 503 passes through', async () => {
		const { dash } = peer('maintenance', 503);
		const e = await dash.doc('/p', '').catch((err: unknown) => err);
		expect(isHttpError(e) && e.status).toBe(503);
	});

	it('a post whose peer answers 403: a 502, and the code said', async () => {
		const { dash, warned } = peer('forbidden', 403);
		const e = await dash
			.postDoc('/p', '', new ArrayBuffer(0), 'text/plain')
			.catch((err: unknown) => err);
		expect(isHttpError(e) && e.status).toBe(502);
		expect(said(warned)).toBe(true);
	});

	for (const status of [200, 300, 304, 305, 399])
		it(`a page document that moves with ${status}, no redirect status: a 502, and the code said`, async () => {
			const { dash, warned } = peer(JSON.stringify({ status, location: '/elsewhere', body: '' }));
			const e = await dash.doc('/p', '').catch((err: unknown) => err);
			expect(isHttpError(e) && e.status).toBe(502);
			expect(said(warned)).toBe(true);
		});

	for (const status of [301, 302, 303, 307, 308])
		it(`a page document that moves with ${status}: the move, as the peer said it`, async () => {
			const { dash } = peer(JSON.stringify({ status, location: '/elsewhere', body: '' }));
			expect(await dash.doc('/p', '')).toMatchObject({ status, location: '/elsewhere' });
		});

	it("a page read the peer answers 404 with its document: the peer's own not-found page", async () => {
		const { dash, warned } = peer(JSON.stringify({ status: 404, body: 'gone', css: [] }), 404);
		expect((await dash.doc('/p', '')).body).toBe('gone');
		expect(said(warned)).toBe(false);
	});
});
