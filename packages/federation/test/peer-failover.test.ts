/**
 * A peer with replicas: a read that one origin answers with a server error (5xx) is asked of the
 * next; any other answer is the answer. A mutation is never asked twice. A cached document turns
 * stale the moment its ttl has passed, not a tick later.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeerHandle } from '../src/peer.ts';
import { set_federation } from '../src/registry.ts';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
});

/** a page document and a widget document in one answer, so either read can take it */
const doc_json = (body: string, status = 200) =>
	JSON.stringify({ status, title: 't', css: [], body, html: `<p>${body}</p>` });

/** origins a.test and b.test: a.test answers `a_status`, b.test answers 200; the hosts asked */
function replicas(a_status: number): string[] {
	const hit: string[] = [];
	vi.stubGlobal('fetch', async (u: URL | string) => {
		const host = new URL(String(u)).host;
		hit.push(host);
		if (host === 'a.test') return new Response(doc_json('from-a', a_status), { status: a_status });
		return new Response(doc_json('from-b'));
	});
	return hit;
}

const cms = () => new PeerHandle('cms', { origin: ['http://a.test', 'http://b.test'] }, 'shell');

describe('replica failover on a server error', () => {
	for (const status of [500, 503]) {
		it(`a page read the first origin answers ${status} is asked of the next`, async () => {
			const hit = replicas(status);
			expect((await cms().doc('/p', '')).body).toBe('from-b');
			expect(hit).toEqual(['a.test', 'b.test']);
		});

		it(`a widget read the first origin answers ${status} is asked of the next`, async () => {
			const hit = replicas(status);
			expect((await cms().widgetDoc('card')).html).toContain('from-b');
			expect(hit).toEqual(['a.test', 'b.test']);
		});
	}

	it('a page answer below 500 is the answer: the next origin is not asked', async () => {
		const hit = replicas(404);
		expect((await cms().doc('/p', '')).body).toBe('from-a');
		expect(hit).toEqual(['a.test']);
	});

	it('a widget answer below 500 is the answer: the next origin is not asked', async () => {
		const hit = replicas(499);
		await cms()
			.widgetDoc('card')
			.catch(() => null); // ok: a 499 is an error answer; what counts is who was asked
		expect(hit).toEqual(['a.test']);
	});

	it('a mutation the first origin answers 503 is never sent to a replica', async () => {
		const hit = replicas(503);
		const body = new TextEncoder().encode('a=1').buffer as ArrayBuffer;
		await cms()
			.postDoc('/p', '', body, 'application/x-www-form-urlencoded')
			.catch(() => null); // ok: the 503 is the answer; what counts is that b.test never saw it
		expect(hit).toEqual(['a.test']);
	});
});

describe('region endpoint replicas', () => {
	function endpoint_replicas(a: () => Response): string[] {
		const hit: string[] = [];
		vi.stubGlobal('fetch', async (u: URL | string) => {
			const host = new URL(String(u)).host;
			hit.push(host);
			return host === 'a.test' ? a() : new Response('<p>from-b</p>');
		});
		return hit;
	}

	it('an origin that does not answer: the next is asked', async () => {
		const hit = endpoint_replicas(() => {
			throw new TypeError('down');
		});
		const res = await cms().endpoint('/__ogygia__?x=1');
		expect(res).toMatchObject({ status: 200 });
		expect(hit).toEqual(['a.test', 'b.test']);
	});

	it('an origin that answers 500: the next is asked', async () => {
		const hit = endpoint_replicas(() => new Response('oops', { status: 500 }));
		expect(await cms().endpoint('/__ogygia__?x=1')).toMatchObject({ status: 200 });
		expect(hit).toEqual(['a.test', 'b.test']);
	});

	it('a target without its leading slash is refused before any origin is asked', async () => {
		const hit = endpoint_replicas(() => new Response('<p>a</p>'));
		expect(await cms().endpoint('__ogygia__?x=1')).toBeNull();
		expect(hit).toEqual([]);
	});
});

describe('the document cache ttl', () => {
	it('a copy exactly ttl old is stale: the read starts a refresh', async () => {
		let calls = 0;
		vi.stubGlobal('fetch', async () => new Response(doc_json(`v${++calls}`)));
		const now = vi.spyOn(Date, 'now');
		const t0 = 1_000_000;
		now.mockReturnValue(t0);
		const peer = new PeerHandle(
			'cms',
			{ origin: 'http://mfe.test', cache: { ttl: 1000 } },
			'shell'
		);
		await peer.doc('/p', '');

		now.mockReturnValue(t0 + 999); // still fresh
		expect((await peer.doc('/p', '')).body).toBe('v1');
		expect(calls).toBe(1);

		now.mockReturnValue(t0 + 1000); // exactly ttl old: stale, served, refreshed
		expect((await peer.doc('/p', '')).body).toBe('v1');
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toBe(2);
	});
});
