// A peer's document reads are one flight per key (#294): a thaw ends only what it names, and a
// caller whose fetch a thaw or a mutation made stale fetches again, so it never gets the old page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@ogygia/router';
import { PeerHandle } from '../src/peer.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fetch that answers when the test says, with the fragment's path and the sources it read. */
function upstream() {
	const out: Array<{ path: string; answer: (body: string, sources: string[]) => void }> = [];
	vi.stubGlobal('fetch', (url: URL) => {
		const path = new URL(String(url)).searchParams.get('path') ?? '';
		return new Promise<Response>((resolve) => {
			out.push({
				path,
				answer: (body, sources) =>
					resolve(
						new Response(JSON.stringify({ status: 200, title: 't', css: [], body, path, sources }))
					)
			});
		});
	});
	return out;
}

const peer = () =>
	new PeerHandle('cms', { origin: 'http://mfe.test', cache: { ttl: 60_000 } }, 'shell');

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('a peer read is one flight per key (#294)', () => {
	it('a thaw of other tags keeps the fetch in flight: its answer is kept', async () => {
		const out = upstream();
		const cms = peer();
		const y = cms.doc('/y', '');
		await tick();
		cms.drop(new Set(['r:cms:x'])); // a publish thaws x while y's fetch is out
		out[0].answer('y', ['y']);
		expect((await y).body).toBe('y');
		// kept: the next read is the cached copy, with no second fetch
		const again = cms.doc('/y', '');
		await tick();
		expect(out).toHaveLength(1);
		expect((await again).body).toBe('y');
	});

	it('a thaw of the tags its answer carries: the waiting caller gets the page fetched again', async () => {
		const out = upstream();
		const cms = peer();
		const x = cms.doc('/x', '');
		await tick();
		cms.drop(new Set(['r:cms:x'])); // the source x changed while the fetch was out
		out[0].answer('before', ['x']);
		await tick();
		expect(out).toHaveLength(2);
		out[1].answer('after', ['x']);
		expect((await x).body).toBe('after');
		expect((await cms.doc('/x', '')).body).toBe('after');
		expect(out).toHaveLength(2);
	});

	it('a mutation while a read is out: the reader gets the page as it is after it', async () => {
		const out = upstream();
		const cms = peer();
		const read = cms.doc('/p', '');
		await tick();
		const post = cms.postDoc('/p', '', new ArrayBuffer(0), 'application/x-www-form-urlencoded');
		await tick();
		expect(out).toHaveLength(3); // the read, the POST, the read again
		out[1].answer('posted', []);
		await post;
		await tick();
		// the read again went out while the POST was: it may be answered from before it, so once the
		// POST ends it is read once more (#331)
		expect(out).toHaveLength(4);
		out[0].answer('before', []);
		out[2].answer('during', []);
		out[3].answer('after', []);
		expect((await read).body).toBe('after');
	});

	it('a read that starts while a mutation is out: once the mutation ends, no read gets the page from before it', async () => {
		const out = upstream();
		const cms = peer();
		const post = cms.postDoc('/p', '', new ArrayBuffer(0), 'application/x-www-form-urlencoded');
		await tick();
		const read = cms.doc('/p', ''); // another visitor reads the page while the POST is out
		await tick();
		expect(out).toHaveLength(2);
		out[1].answer('before', []); // the upstream answers that read before it applied the POST
		expect((await read).body).toBe('before'); // (the page as it was when it asked)
		out[0].answer('posted', []); // the POST is applied, and answered
		await post;
		const after = cms.doc('/p', ''); // the poster's redirect GET
		await tick();
		expect(out).toHaveLength(3); // the copy from before the POST is not served
		out[2].answer('after', []);
		expect((await after).body).toBe('after');
	});

	it('a page whose sources move during every fetch of it: the read gives up with a 504 and the code said, and does not fetch it forever (#1792)', async () => {
		const out = upstream();
		const warned: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation(
			(...a: unknown[]) => void warned.push(a.join(' '))
		);
		const cms = peer();
		let ended: unknown = null;
		cms.doc('/p', '').then(
			() => (ended = 'a page'),
			(e: unknown) => (ended = e)
		);
		for (let n = 0; n < 100; n++) {
			await tick();
			if (ended !== null) break;
			expect(out).toHaveLength(n + 1);
			cms.drop(new Set(['r:cms:x']));
			out[n].answer(`p@${n}`, ['x']);
		}
		await tick();
		expect(isHttpError(ended) && ended.status).toBe(504);
		expect(out.length).toBeLessThan(100);
		expect(warned.some((w) => w.includes('federation_peer_read_dropped'))).toBe(true);
	});
});
