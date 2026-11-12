// The oracles on the palaestra build: a page at rest keeps ogygia's rules, has no errors, and
// equals a fresh hard load of its URL. (Skipped without `OGYGIA_RULES=1 vite build` there.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import {
	document_faulted,
	fallback_stands,
	faulted,
	hydrates_as_sent,
	KNOWN,
	Leaks,
	mpa_equivalent,
	normalize,
	page_errors,
	page_rules,
	regions_show
} from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

describe('normalize', () => {
	it('drops scripts, comments, nonces and blank text; keeps attributes and text', async () => {
		const { Window } = await import('happy-dom');
		const w = new Window();
		w.document.write(
			'<html><head><title>t</title><script nonce="x">1</script></head><body>\n  <!--[--><p class="a" nonce="y">hi</p><!--]-->\n</body></html>'
		);
		expect(normalize(w.document as unknown as Document)).toBe(
			[
				'title: t',
				'<html>',
				'  <head>',
				'    <title>',
				'      "t"',
				'  <body>',
				'    <p class="a">',
				'      "hi"'
			].join('\n')
		);
	});

	it("drops a page store's mark: a stored copy is the render it kept (gen 63, seed 26)", async () => {
		const { Window } = await import('happy-dom');
		const page = (head: string) => {
			const w = new Window();
			w.document.write(`<html><head><title>t</title>${head}</head><body><p>hi</p></body></html>`);
			return normalize(w.document as unknown as Document);
		};
		expect(page('<meta name="ogygia-stored" content="hit">')).toBe(page(''));
	});

	it("takes the region sheets answers lifted into the head in any order, and the page's own in theirs (gen 143, seed 143019)", async () => {
		const { Window } = await import('happy-dom');
		const page = (...hrefs: string[]) => {
			const w = new Window({ url: 'https://app.test/' });
			w.document.write(
				`<html><head>${hrefs.map((h) => (h.startsWith('og:') ? `<link rel="stylesheet" data-ogygia-region-css="" href="/${h.slice(3)}">` : `<link rel="stylesheet" href="/${h}">`)).join('')}</head><body></body></html>`
			);
			return normalize(w.document as unknown as Document);
		};
		// (each answer's sheets go in as it lands: which hole answered first is the network's)
		expect(page('a.css', 'og:x.css', 'og:y.css')).toBe(page('a.css', 'og:y.css', 'og:x.css'));
		expect(page('a.css', 'b.css')).not.toBe(page('b.css', 'a.css'));
	});
});

describe('known', () => {
	it("#993's hole without its page's data, on either side (gen 175, seed 175003)", () => {
		const k = KNOWN.find((x) => x.issue === 993)!;
		const page = (who: string[]) =>
			[
				'title: ',
				'<html>',
				'  <body>',
				'    <div data-gen="hole">',
				'      <i data-gen-page="">',
				...who.map((l) => `        ${l}`),
				'      <span>',
				'        "n19"'
			].join('\n');
		const shown = page([]);
		const fresh = page(['"p2 data"']);
		expect(k.applies(shown, fresh)).toBe(true);
		expect(k.applies(fresh, fresh)).toBe(false);
		expect(k.forgive(shown, fresh)).toBe(k.forgive(fresh, shown));
	});

	it("#995's is seen in a document that sent a hole batch (gen 190, seed 190007)", () => {
		const k = KNOWN.find((x) => x.issue === 995)!;
		const world = (method: string) =>
			({
				network: {
					exchanges: [{ from: 'tab-1#1', method, url: 'https://app.test/__ogygia__' }]
				}
			}) as unknown as World;
		const tab = { realm: 'tab-1#1' } as unknown as Parameters<NonNullable<typeof k.seen>>[1];
		expect(k.seen!(world('POST'), tab)).toBe(true);
		expect(k.seen!(world('GET'), tab)).toBe(false);
	});
});

describe('every region shows something', () => {
	it("passes a region the app's empty component left empty, in its marked element", async () => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/p0' });
		w.document.write(
			'<html><body><div data-gen-empty><ogygia-region entry="e1"></ogygia-region></div><div><ogygia-region entry="e2"></ogygia-region></div></body></html>'
		);
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			documents: 1,
			page: { mainFrame: { url: 'https://app.test/p0', document: w.document } }
		} as unknown as Parameters<typeof regions_show>[0];
		const world = {
			fired_in: new Map(),
			network: { exchanges: [] },
			skewed_for: () => false,
			frag_refused: new Set()
		} as unknown as Parameters<typeof regions_show>[1];
		const found = regions_show(tab, world);
		expect(found?.oracle).toBe('empty-region');
		expect(found?.detail).toContain('entry="e2"');
		expect(found?.detail).not.toContain('entry="e1"');
	});
});

describe("a hole's fallback does not stand", () => {
	/** `wire`: the document's requests, each `[url, status]`. */
	const at_rest = async (body: string, wire: Array<[string, number | 'dropped']> = []) => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/p1' });
		w.document.write(`<html><body>${body}</body></html>`);
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			documents: 1,
			page: { mainFrame: { url: 'https://app.test/p1', document: w.document } }
		} as unknown as Parameters<typeof fallback_stands>[0];
		const world = {
			fired_in: new Map(),
			network: {
				exchanges: wire.map(([url, status], i) => ({
					id: i + 1,
					from: 'tab-1#1',
					method: 'GET',
					url: `https://app.test${url}`,
					status,
					cut: false,
					tampered: false,
					redirected: false
				}))
			},
			skewed_for: () => false
		} as unknown as Parameters<typeof fallback_stands>[1];
		return fallback_stands(tab, world);
	};
	const hole = (when: string, fallback: string) =>
		`<ogygia-region render="defer" when="${when}" endpoint="/__ogygia__?id=a"><p ${fallback}>loading n1…</p></ogygia-region>`;

	it('finds a load or idle hole still showing its fallback at rest (a mutant that never fetched survived)', async () => {
		expect((await at_rest(hole('idle', 'data-gen-fallback')))?.oracle).toBe('fallback-stands');
		expect((await at_rest(hole('load', 'data-gen-fallback')))?.oracle).toBe('fallback-stands');
	});

	it('finds one never asked for in a document a fault touched elsewhere, and passes one whose own request failed', async () => {
		// (a mutant that never fetched survived: nearly every run has a fault somewhere)
		const other: [string, 'dropped'] = ['/_app/immutable/x.js', 'dropped'];
		expect((await at_rest(hole('idle', 'data-gen-fallback'), [other]))?.oracle).toBe(
			'fallback-stands'
		);
		expect(
			await at_rest(hole('idle', 'data-gen-fallback'), [
				other,
				['/__ogygia__?id=a&exp=1&sig=s', 'dropped']
			])
		).toBeNull();
	});

	it('passes one that keeps it by design, one waiting for the visitor, and an answered one', async () => {
		expect(await at_rest(hole('load', 'data-gen-fallback data-gen-kept'))).toBeNull();
		expect(await at_rest(hole('interaction', 'data-gen-fallback'))).toBeNull();
		expect(
			await at_rest(
				'<ogygia-region render="defer" when="load" endpoint="/__ogygia__?id=a"><div>n1</div></ogygia-region>'
			)
		).toBeNull();
	});
});

describe('hydrates as sent', () => {
	it("a changed byte in a peer's deferred widget excuses its mismatch (gen 87, seed 34)", () => {
		const tab = {
			realm: 'tab-2#1',
			name: 'tab-2',
			documents: 1,
			errors: [],
			console: ['warn: https://svelte.dev/e/hydration_mismatch'],
			page: { mainFrame: { url: 'https://app.test/p1' } }
		} as unknown as Parameters<typeof hydrates_as_sent>[0];
		const world = {
			network: {
				exchanges: [
					{ url: 'https://app.test/p1', tampered: false },
					{ url: 'https://app.test/og/frag?peer=peer&kind=widget&target=w0', tampered: true }
				].map((e, i) => ({
					id: i + 1,
					from: 'tab-2#1',
					method: 'GET',
					status: 200,
					cut: false,
					...e
				}))
			}
		} as unknown as Parameters<typeof hydrates_as_sent>[1];
		expect(hydrates_as_sent(tab, world)).toBeNull();
	});
});

describe('page errors', () => {
	const tab = (errors: string[]) =>
		({
			realm: 'tab-1#6',
			name: 'tab-1',
			documents: 6,
			errors,
			console: [],
			page: { mainFrame: { url: 'https://app.test/split-brain' } }
		}) as unknown as Parameters<typeof page_errors>[0];
	// (the document's own load is its realm's first request)
	const world = (tampered: string) =>
		({
			fired_in: new Map(),
			network: {
				exchanges: ['https://app.test/split-brain', 'https://app.test/_app/x.js'].map((url, i) => ({
					id: i + 1,
					from: 'tab-1#6',
					method: 'GET',
					url,
					status: 200,
					cut: false,
					tampered: url === tampered
				}))
			}
		}) as unknown as Parameters<typeof page_errors>[1];
	const said = ["error: Cannot read properties of undefined (reading 'toLowerCase')"];

	it('a document whose own HTML was changed on the way may say anything (seed 150)', () => {
		expect(page_errors(tab(said), world('https://app.test/split-brain'))).toBeNull();
	});

	it('a changed chunk does not excuse a TypeError', () => {
		expect(page_errors(tab(said), world('https://app.test/_app/x.js'))?.oracle).toBe('page-errors');
	});

	// (a server's hop for the document: a peer's page it was made from; gen 32, seed 32008)
	const hop = (change: 'tampered' | 'cut') =>
		({
			fired_in: new Map(),
			network: {
				exchanges: [
					{ id: 1, from: 'tab-1#6', url: 'https://app.test/peer/q0', status: 200 },
					{
						id: 2,
						from: 'server-0',
						for: 'tab-1#6',
						url: 'https://peer.test/og/fragment/page',
						status: 200,
						cut: change === 'cut',
						tampered: change === 'tampered'
					}
				].map((e) => ({ method: 'GET', cut: false, tampered: false, ...e }))
			}
		}) as unknown as Parameters<typeof page_errors>[1];

	it("a changed byte in a peer's page the server fetched for the document is the document's", () => {
		expect(page_errors(tab(said), hop('tampered'))).toBeNull();
	});

	it('a cut hop is a failure the app answers, and excuses nothing', () => {
		expect(page_errors(tab(said), hop('cut'))?.oracle).toBe('page-errors');
	});

	// (gen 125, seed 125013: the changed peer page was fetched for another document, and the app
	// kept it, `cache: { ttl }`: this document, and the MPA check's fresh load, may be shown it)
	it("a changed byte in a peer's page the server fetched for another document is this one's too", () => {
		const world = {
			fired_in: new Map(),
			network: {
				exchanges: [
					{ id: 1, from: 'tab-0#2', url: 'https://app.test/peer/q0', status: 200 },
					{
						id: 2,
						from: 'server-1',
						for: 'tab-0#2',
						url: 'https://peer.test/og/fragment/page?path=%2Fq0',
						status: 200,
						tampered: true
					},
					{ id: 3, from: 'tab-1#6', url: 'https://app.test/peer/q0', status: 200 }
				].map((e) => ({ method: 'GET', cut: false, tampered: false, ...e }))
			}
		} as unknown as World;
		const t = {
			realm: 'tab-1#6',
			name: 'tab-1',
			documents: 6,
			errors: [],
			console: [],
			page: { mainFrame: { url: 'https://app.test/peer/q0' } }
		} as unknown as Parameters<typeof faulted>[1];
		expect(document_faulted(world, t)).toBe(true);
		expect(faulted(world, t)).toBe(true);
	});
});

describe('leaks', () => {
	const doc = { head: { children: [], querySelectorAll: () => [] } };
	/** A tab whose visits of one URL hold these listeners, one list per visit. */
	const visits = (...lists: string[][]) => {
		const leaks = new Leaks();
		let now: string[] = [];
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			platform: null,
			page: { mainFrame: { url: 'https://app.test/', document: doc } },
			held: () => ({ listeners: now.length, intervals: 0, observers: 0, head: 0, elements: 0 }),
			listening: () => now,
			watching: () => []
		} as unknown as Parameters<Leaks['check']>[0];
		let found: ReturnType<Leaks['check']> = null;
		for (const list of lists) {
			now = list;
			found = leaks.check(tab);
			// (another URL between: the next sample is a new visit)
			const url = tab.page.mainFrame.url;
			(tab.page.mainFrame as { url: string }).url = 'https://app.test/other';
			leaks.check(tab);
			(tab.page.mainFrame as { url: string }).url = url;
		}
		return found;
	};

	it('the same code added again on every visit is a leak', () => {
		const a = 'document click f1';
		expect(visits([a], [a, a], [a, a, a])?.oracle).toBe('leak');
	});

	it('observers made once each for the document, as each visit first needs one, are not growth (gen 195, seed 195005)', () => {
		// (import-again's timing observer, the viewport tracker's, then its children's: one of each)
		const watched = (...lists: string[][]) => {
			const leaks = new Leaks();
			let now: string[] = [];
			const tab = {
				realm: 'tab-1#1',
				name: 'tab-1',
				platform: null,
				page: { mainFrame: { url: 'https://app.test/', document: doc } },
				held: () => ({ listeners: 0, intervals: 0, observers: now.length, head: 0, elements: 0 }),
				listening: () => [],
				watching: () => now
			} as unknown as Parameters<Leaks['check']>[0];
			let found: ReturnType<Leaks['check']> = null;
			for (const list of lists) {
				now = list;
				found = leaks.check(tab);
				(tab.page.mainFrame as { url: string }).url = 'https://app.test/other';
				leaks.check(tab);
				(tab.page.mainFrame as { url: string }).url = 'https://app.test/';
			}
			return found;
		};
		const po = 'PerformanceObserver f1';
		const io = 'IntersectionObserver f2';
		const mo = 'MutationObserver f3';
		expect(watched([po], [po, io], [po, io, mo])).toBeNull();
		// (the same code observing once more on every visit is a leak)
		expect(watched([io], [io, io], [io, io, io])?.oracle).toBe('leak');
	});

	it("a page store's mark a stored visit brings is not growth (gen 61, seed 36)", async () => {
		const { Window } = await import('happy-dom');
		const w = new Window();
		const d = w.document as unknown as Document;
		d.write('<html><head><title>t</title></head><body><p>hi</p></body></html>');
		const leaks = new Leaks();
		const count = () => d.getElementsByTagName('*').length;
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			platform: null,
			page: { mainFrame: { url: 'https://app.test/', document: d } },
			held: () => ({
				listeners: 0,
				intervals: 0,
				observers: 0,
				head: d.head.children.length,
				elements: count()
			}),
			listening: () => [],
			watching: () => []
		} as unknown as Parameters<Leaks['check']>[0];
		const visit = () => {
			const found = leaks.check(tab);
			(tab.page.mainFrame as { url: string }).url = 'https://app.test/other';
			leaks.check(tab);
			(tab.page.mainFrame as { url: string }).url = 'https://app.test/';
			return found;
		};
		visit();
		// (the router's announcer, once per document, then a stored copy's mark)
		d.body.append(d.createElement('div'));
		visit();
		const mark = d.createElement('meta');
		mark.setAttribute('name', 'ogygia-stored');
		d.head.append(mark);
		expect(visit()).toBeNull();
	});

	it('new code installed once on each visit is not (generated-app 6, seed 12)', () => {
		expect(
			visits(
				['document click f1'],
				['document click f1', 'document keydown f2'],
				['document click f1', 'document keydown f2', 'document click f3']
			)
		).toBeNull();
	});
});

describe.skipIf(!built)('oracles on the palaestra build', () => {
	it('the home page at rest: rules kept, no errors, equal to a fresh hard load', async () => {
		const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('alice');
			const tab = world.tab(v);
			await world.go(tab, 'goto', '/');
			expect(page_errors(tab)).toBeNull();
			expect(page_rules(tab)).toBeNull();
			expect(await mpa_equivalent(world, v, tab)).toBeNull();
		} finally {
			await world.end();
		}
	});
});
