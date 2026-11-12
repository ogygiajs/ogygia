// The waste oracle (src/waste.ts): it finds an answer asked for twice, a thing a document holds
// twice and a warning, and lets a page that does its work once pass.
import { describe, expect, it } from 'vitest';
import {
	asked_twice,
	asked_twice_each,
	held_twice,
	known_waste,
	refused,
	warned
} from '../src/waste.ts';
import type { World } from '../src/world.ts';

const world = (urls: Array<[string, number | 'dropped']>) =>
	({
		network: {
			exchanges: urls.map(([url, status], i) => ({
				id: i + 1,
				from: 'tab-1#1',
				method: 'GET',
				url: `https://app.test${url}`,
				at: i,
				status,
				cut: false,
				tampered: false,
				duplicated: false,
				redirected: false
			}))
		}
	}) as unknown as World;

describe('asked twice', () => {
	it("finds a hole's answer asked for twice, less its expiry and signature", () => {
		const w = world([
			['/__ogygia__?id=a&props=x&exp=1&sig=s', 200],
			['/__ogygia__?id=a&props=x&exp=2&sig=t', 200]
		]);
		expect(asked_twice(w, 'tab-1#1')).toEqual(['/__ogygia__?id=a&props=x ×2']);
	});

	it('passes a retry after a failure, files, pages and two different answers', () => {
		const w = world([
			['/__ogygia__?id=a&props=x&exp=1&sig=s', 'dropped'],
			['/__ogygia__?id=a&props=x&exp=1&sig=s', 200],
			['/__ogygia__?id=b&props=x&exp=1&sig=s', 200],
			['/_app/immutable/chunks/a.js', 200],
			['/_app/immutable/chunks/a.js', 200],
			['/p1', 200],
			['/p1', 200]
		]);
		expect(asked_twice(w, 'tab-1#1')).toEqual([]);
	});

	it("passes a held region's remote query asked again by the router's next visit, a back's too (gen 187, seed 187004)", () => {
		// (a back is a new visit: its regions mount again and ask again, as a page is asked again)
		const query = '/_app/remote/h1/q?payload=x';
		const w = world([
			[query, 200],
			['/p1', 200],
			[query, 200]
		]);
		// the router swapped pages at 1 (to /p1) and at 2 (back to the held region's page)
		expect(asked_twice(w, 'tab-1#1', [1, 2])).toEqual([]);
		// (within one visit it is asked twice)
		expect(asked_twice(w, 'tab-1#1')).toEqual([`${query} ×2`]);
		// (a hole's answer is still the document's: its region answers it from the page it held)
		const hole = world([
			['/__ogygia__?id=a&props=x', 200],
			['/__ogygia__?id=a&props=x', 200]
		]);
		expect(asked_twice(hole, 'tab-1#1', [1])).toEqual(['/__ogygia__?id=a&props=x ×2']);
	});

	it("finds a left page's hole answer a router batch asks for again 20 s later, and passes one asked again after its 60 s linger", () => {
		// (a page left and come back to: the frame store keeps a left page's answers 60 s; the
		// frame-store EVICT_TTL mutant at 6 s asked again in a batch and survived)
		const at = (ms: number[], holes?: string[]) =>
			({
				network: {
					exchanges: ms.map((t, i) => ({
						id: i + 1,
						from: 'tab-1#1',
						method: i === 0 ? 'GET' : 'POST',
						url: `https://app.test/__ogygia__${i === 0 ? '?id=a&props=x&exp=1&sig=s' : ''}`,
						at: t,
						status: 200,
						cut: false,
						tampered: false,
						duplicated: false,
						redirected: false,
						...(i > 0 && { holes })
					}))
				}
			}) as unknown as World;
		const hole = '/__ogygia__?id=a&props=x';
		expect(asked_twice(at([1000, 21_000], [hole]), 'tab-1#1')).toEqual([`${hole} ×2`]);
		expect(asked_twice(at([1000, 62_000], [hole]), 'tab-1#1')).toEqual([]);
		// (a batch that asks another hole is that hole's)
		expect(asked_twice(at([1000, 21_000], ['/__ogygia__?id=b&props=x']), 'tab-1#1')).toEqual([]);
	});
});

describe('asked twice in every document, up to what first disturbed it', () => {
	// (a document judged only at the end of a run was nearly always set aside by then: a press, a
	// deploy or a fault came later, and the frame-store EVICT_TTL mutant's re-ask was never judged)
	const hole = '/__ogygia__?id=a&props=x';
	const run = (rows: Array<[string, string, number | 'dropped']>) =>
		({
			fired_in: new Map(),
			skewed_for: () => false,
			network: {
				exchanges: rows.map(([from, url, status], i) => ({
					id: i + 1,
					from,
					method: 'GET',
					url: `https://app.test${url}&exp=${i}&sig=s`,
					at: i * 1000,
					status,
					cut: false,
					tampered: false,
					duplicated: false,
					redirected: false
				}))
			}
		}) as unknown as World;
	const docs = new Map([
		['tab-1#1', []],
		['tab-1#2', []]
	]);

	it('finds a left document that asked twice before anything disturbed it', () => {
		const w = run([
			['tab-1#1', hole, 200],
			['tab-1#1', hole, 200],
			['tab-1#1', '/__ogygia__?id=b&props=x', 'dropped'],
			['tab-1#2', hole, 200]
		]);
		expect(asked_twice_each(w, docs, new Map([['tab-1#1', 3]]))?.detail).toBe(
			`tab-1#1: asked twice: ${hole} ×2`
		);
	});

	it('passes asks after a press, a deploy or a fault in that document', () => {
		const w = run([
			['tab-1#1', hole, 200],
			['tab-1#1', '/__ogygia__?id=b&props=x', 'dropped'],
			['tab-1#1', hole, 200],
			['tab-1#2', hole, 200],
			['tab-1#2', hole, 200]
		]);
		// (a press in tab-1#2 before its second ask: exchange 4)
		expect(asked_twice_each(w, docs, new Map([['tab-1#2', 4]]))).toBeNull();
	});

	it("counts a router visit's batch asking a held answer again as #1020's", () => {
		const w = run([['tab-1#1', hole, 200]]);
		w.network.exchanges.push({
			...w.network.exchanges[0],
			id: 2,
			method: 'POST',
			url: 'https://app.test/__ogygia__',
			at: 5000,
			holes: [hole]
		});
		// (sent as the router swapped the page in: the navigation's batch)
		expect(asked_twice_each(w, new Map([['tab-1#1', [5000]]]), new Map())).toEqual({
			oracle: 'known',
			detail: 'tab-1#1: #1020 (a router return asks again for hole answers the frame store holds)'
		});
		// (any other batch asking it again is waste)
		expect(asked_twice_each(w, new Map([['tab-1#1', [4000]]]), new Map())?.oracle).toBe('waste');
	});
});

describe('refused', () => {
	it('finds a batch the app refused, and passes a refused GET (a capability renews with one) (gen 157, seed 3)', () => {
		const w = world([
			['/__ogygia__?id=a&exp=1&sig=s', 403],
			['/og/frag', 403],
			['/og/frag?peer=p&sig=s', 200]
		]);
		(w.network.exchanges[1] as { method: string }).method = 'POST';
		expect(refused(w, 'tab-1#1')).toEqual(['POST /og/frag 403']);
	});
});

describe('held twice', () => {
	it('finds a stylesheet, a style, props and a preload twice, and passes each once', async () => {
		const { Window } = await import('happy-dom');
		const doc = (body: string) => {
			const w = new Window({ url: 'https://app.test/' });
			w.document.write(`<html><head></head><body>${body}</body></html>`);
			return w.document as unknown as Document;
		};
		const once =
			'<link rel="stylesheet" href="/a.css"><style>p{}</style><script type="application/json" data-ogygia-props="f1">{}</script><link rel="modulepreload" href="/m.js">';
		expect(held_twice(doc(once))).toEqual([]);
		expect(held_twice(doc(once + once))).toEqual([
			'stylesheet https://app.test/a.css',
			'style p{}',
			'props f1:{}',
			'module preload https://app.test/m.js'
		]);
	});

	it("passes one island's props in two regions answered apart, each its own (gen 173, seed 17)", async () => {
		// (two slots of one peer widget, each a fetched answer that carries its island's props: an
		// answer stands alone, so taking one away leaves the other's island its props)
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/' });
		const props = '<script type="application/json" data-ogygia-props="f1">{}</script>';
		const answer = (n: number) =>
			`<ogygia-region render="defer" endpoint="/og/frag?slot=${n}"><section>${props}</section></ogygia-region>`;
		w.document.write(`<html><head></head><body>${answer(1)}${answer(2)}</body></html>`);
		expect(held_twice(w.document as unknown as Document)).toEqual([]);
		// (twice in one answer, or in the page's own HTML, is still twice)
		const x = new Window({ url: 'https://app.test/' });
		x.document.write(
			`<html><head></head><body>${props}<ogygia-region endpoint="/og/frag?slot=1">${props}${props}</ogygia-region></body></html>`
		);
		expect(held_twice(x.document as unknown as Document)).toEqual(['props f1:{}']);
	});
});

describe('known waste', () => {
	it("counts #984's second link to a chunk, the graph preload's, as known", async () => {
		const { Window } = await import('happy-dom');
		const doc = (second: string) => {
			const w = new Window({ url: 'https://app.test/' });
			w.document.write(
				`<html><head><link rel="modulepreload" as="script" crossorigin="" href="/m.js">${second}</head><body></body></html>`
			);
			return w.document as unknown as Document;
		};
		const ours = '<link rel="modulepreload" href="/m.js" data-ogygia-graph-preload="">';
		expect(known_waste(doc(ours), held_twice(doc(ours)))).toEqual({
			left: [],
			known: [984]
		});
		const html = '<link rel="modulepreload" href="/m.js">';
		expect(known_waste(doc(html), held_twice(doc(html)))).toEqual({
			left: ['module preload https://app.test/m.js'],
			known: []
		});
	});
});

describe('warned', () => {
	it("is what the document itself warned, not an earlier document's", () => {
		const tab = {
			realm: 'tab-1#2',
			console: ['warn: old', 'warn: new', 'log: fine'],
			said_by: new Map([
				['warn: old', 'tab-1#1'],
				['warn: new', 'tab-1#2']
			])
		} as unknown as Parameters<typeof warned>[0];
		expect(warned(tab)).toEqual(['warn: new']);
	});
});
