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
