// The oracles on the palaestra build: a page at rest keeps ogygia's rules, has no errors, and
// equals a fresh hard load of its URL. (Skipped without `OGYGIA_RULES=1 vite build` there.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import {
	hydrates_as_sent,
	Leaks,
	mpa_equivalent,
	normalize,
	page_errors,
	page_rules
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
			listening: () => now
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
			listening: () => []
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
