// The on-device search client and its worker (#207): every query is answered or rejected, never left
// waiting. A fake Worker stands in for the browser's (the protocol between the two is what is under
// test); the worker module itself runs against a fake `self`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchClient } from '../src/site/search-client.ts';

type Message = Record<string, unknown>;

class FakeWorker {
	static last: FakeWorker | null = null;
	posted: Message[] = [];
	terminated = false;
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: ErrorEvent) => void) | null = null;
	constructor() {
		FakeWorker.last = this;
	}
	postMessage(m: Message) {
		this.posted.push(m);
	}
	terminate() {
		this.terminated = true;
	}
	/** The worker answers. */
	answer(m: Message) {
		this.onmessage?.({ data: m } as MessageEvent);
	}
	crash(message: string) {
		this.onerror?.({ message } as ErrorEvent);
	}
	queries(): Message[] {
		return this.posted.filter((m) => m.type === 'query');
	}
}

/** Settles within `ms`, or says it is still waiting. */
const within = <T>(p: Promise<T>, ms = 200) =>
	Promise.race([
		p.then(
			(v) => ({ settled: 'resolved' as const, v }),
			(e: Error) => ({ settled: 'rejected' as const, v: e.message })
		),
		new Promise<{ settled: 'waiting'; v: null }>((r) =>
			setTimeout(() => r({ settled: 'waiting', v: null }), ms)
		)
	]);

describe('SearchClient: a query is answered or rejected, never left waiting', () => {
	beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
	afterEach(() => vi.unstubAllGlobals());

	it('a query the worker answers', async () => {
		const s = new SearchClient({ base: '/docs' });
		const w = FakeWorker.last!;
		w.answer({ type: 'ready' });
		const q = s.query('install');
		const { id } = w.queries()[0] as { id: number };
		w.answer({ type: 'result', id, hits: [{ href: '/docs/install' }] });
		expect(await within(q)).toEqual({ settled: 'resolved', v: [{ href: '/docs/install' }] });
	});

	it('a query the worker fails: rejected with the worker’s message', async () => {
		const s = new SearchClient();
		const w = FakeWorker.last!;
		w.answer({ type: 'ready' });
		const q = s.query('install');
		const { id } = w.queries()[0] as { id: number };
		w.answer({ type: 'error', id, message: 'query failed' });
		expect(await within(q)).toEqual({ settled: 'rejected', v: 'query failed' });
	});

	it('the index fails to load: the queries waiting on it, and every query after, are rejected', async () => {
		const s = new SearchClient();
		const w = FakeWorker.last!;
		const early = s.query('install');
		const ready = s.ready.catch((e: Error) => e.message);
		w.answer({ type: 'error', message: 'search index failed to load (404)' });
		expect(await ready).toBe('search index failed to load (404)');
		expect(await within(early)).toEqual({
			settled: 'rejected',
			v: 'search index failed to load (404)'
		});
		expect(await within(s.query('again'))).toEqual({
			settled: 'rejected',
			v: 'search index failed to load (404)'
		});
	});

	it('the worker crashes: waiting queries and later ones are rejected', async () => {
		const s = new SearchClient();
		const w = FakeWorker.last!;
		w.answer({ type: 'ready' });
		const waiting = s.query('install');
		w.crash('worker died');
		expect((await within(waiting)).settled).toBe('rejected');
		expect((await within(s.query('again'))).settled).toBe('rejected');
	});

	it('destroy(): waiting queries and later ones are rejected, the worker ends', async () => {
		const s = new SearchClient();
		const w = FakeWorker.last!;
		w.answer({ type: 'ready' });
		const waiting = s.query('install');
		s.destroy();
		expect(w.terminated).toBe(true);
		expect((await within(waiting)).settled).toBe('rejected');
		expect((await within(s.query('again'))).settled).toBe('rejected');
	});

	it('destroy() twice is the same as once (a manual destroy, then the palette’s unmount)', () => {
		const s = new SearchClient();
		s.destroy();
		expect(() => s.destroy()).not.toThrow();
	});

	it('an empty query is [] at once, in any state', async () => {
		const s = new SearchClient();
		s.destroy();
		expect(await s.query('  ')).toEqual([]);
	});
});

describe('the search worker: a failed query is answered with its id', () => {
	let posted: Message[] = [];
	const self_fake = {
		onmessage: null as ((e: MessageEvent) => Promise<void>) | null,
		postMessage: (m: Message) => posted.push(m)
	};

	beforeEach(() => {
		posted = [];
		vi.resetModules();
		vi.stubGlobal('self', self_fake);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('the index failed to build: a query is answered `error` with ITS id', async () => {
		vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));
		await import('../src/site/search-worker.ts');
		await self_fake.onmessage!({ data: { type: 'load', url: '/search.json' } } as MessageEvent);
		expect(posted.at(-1)).toMatchObject({ type: 'error' });
		await self_fake.onmessage!({ data: { type: 'query', id: 7, q: 'x' } } as MessageEvent);
		expect(posted.at(-1)).toMatchObject({ type: 'error', id: 7 });
	});

	it('the index failed to download once: the next query downloads it again and is answered', async () => {
		const doc = {
			id: 'install',
			slug: 'install',
			anchor: '',
			title: 'Install',
			section: 'Start',
			heading: '',
			text: 'Run the installer.'
		};
		let fetches = 0;
		vi.stubGlobal('fetch', async () =>
			++fetches === 1 ? new Response('busy', { status: 503 }) : Response.json([doc])
		);
		await import('../src/site/search-worker.ts');
		await self_fake.onmessage!({ data: { type: 'load', url: '/search.json' } } as MessageEvent);
		expect(posted.at(-1)).toMatchObject({ type: 'error' });
		expect((posted.at(-1) as { message: string }).message).toContain(
			'content_search_index_fetch_failed'
		);
		await self_fake.onmessage!({ data: { type: 'query', id: 8, q: 'install' } } as MessageEvent);
		expect(fetches).toBe(2);
		expect(posted.at(-1)).toMatchObject({ type: 'result', id: 8 });
		expect((posted.at(-1) as { hits: { title: string }[] }).hits[0]).toMatchObject({
			title: 'Install'
		});
	});

	it('a newer load replaces the index a waiting query was going to read: it is answered from the new one', async () => {
		const doc = (title: string) => ({
			id: title,
			slug: title,
			anchor: '',
			title,
			section: 'Start',
			heading: '',
			text: 'Run the installer.'
		});
		let release_old!: () => void;
		vi.stubGlobal('fetch', async (url: string) => {
			if (url === '/old.json') await new Promise<void>((r) => (release_old = r));
			return Response.json([doc(url === '/old.json' ? 'Old' : 'New')]);
		});
		await import('../src/site/search-worker.ts');
		const old_load = self_fake.onmessage!({
			data: { type: 'load', url: '/old.json' }
		} as MessageEvent);
		const query = self_fake.onmessage!({
			data: { type: 'query', id: 9, q: 'installer' }
		} as MessageEvent);
		await self_fake.onmessage!({ data: { type: 'load', url: '/new.json' } } as MessageEvent);
		release_old();
		await Promise.all([old_load, query]);
		const result = posted.find((m) => (m as { id?: number }).id === 9) as {
			hits: { title: string }[];
		};
		expect(result.hits.map((h) => h.title)).toEqual(['New']);
	});
});
