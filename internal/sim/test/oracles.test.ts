// The oracles on the palaestra build: a page at rest keeps ogygia's rules, has no errors, and
// equals a fresh hard load of its URL. (Skipped without `OGYGIA_RULES=1 vite build` there.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import type { Heard } from '../src/browser.ts';
import {
	document_faulted,
	fallback_stands,
	faulted,
	hydrates_as_sent,
	KNOWN,
	Leaks,
	live_events,
	mpa_equivalent,
	normalize,
	live_regions_out,
	page_errors,
	reshaped_live,
	page_rules,
	regions_show,
	styled_regions
} from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

describe('a live region whose tick changes its shape', () => {
	// (gen 194: a switching live region cycles its own region, another interactive one and a static
	// one; each side, looked at again 4 s later, had moved on to another shape, and nothing was
	// masked: seeds 25, 26, 42, 43, 45, 64)
	const page = (inside: string[], live = 'true') =>
		[
			'<body>',
			'  <ogygia-region wake="load">',
			`    <ogygia-region live="${live}" endpoint="/__ogygia__?props=x">`,
			...inside.map((l) => `      ${l}`),
			'  <p>',
			'    "after"'
		].join('\n');
	const other = ['<div data-gen="live-other">', '  <span>', '    "n1 tick 211"', '  <button>'];
	const still = ['<div data-gen="live-static">', '  <span>', '    "n1 tick 212"'];
	const own = ['<div data-gen="live">', '  <span>', '    "n1 tick 41"', '  <i>'];

	it('is set aside whole on both sides when either side moved to another shape', () => {
		const moving = new Set([
			...reshaped_live(page(other), page(still)),
			...reshaped_live(page(own), page(own))
		]);
		expect([...moving]).toEqual([0]);
		expect(live_regions_out(page(other), moving)).toBe(live_regions_out(page(own), moving));
		expect(live_regions_out(page(other), moving)).toContain('"after"');
	});

	it('inside a live held region, sets aside the outer one whole and nothing after it (gen 235, seed 15)', () => {
		const held = (inside: string[]) =>
			[
				'<body>',
				'  <ogygia-region wake="load">',
				'    <ogygia-region live="true" endpoint="/__ogygia__?props=held">',
				'      <div data-gen="held">',
				'        <ogygia-region live="true" endpoint="/__ogygia__?props=x">',
				...inside.map((l) => `          ${l}`),
				'        <div data-gen="island">',
				'  <div data-gen="island">',
				'    <span>',
				'      "n10"'
			].join('\n');
		const moving = reshaped_live(held(other), held(still));
		expect([...moving].sort()).toEqual([0, 1]);
		const out = live_regions_out(held(other), moving);
		expect(out).toBe(live_regions_out(held(still), moving));
		expect(out.split('\n').slice(-3)).toEqual([
			'  <div data-gen="island">',
			'    <span>',
			'      "n10"'
		]);
	});

	it('is compared as it is when neither side moved to another shape', () => {
		expect(reshaped_live(page(other), page(other)).size).toBe(0);
		// (a region that is not live never moves by itself)
		expect(reshaped_live(page(other, 'false'), page(still, 'false')).size).toBe(0);
	});
});

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

	it("drops a region's repair mark: a third party edited it before it woke on one load only (gen 192, seed 19)", async () => {
		// (a third party's script waiting for DOMContentLoaded edits a document load's islands, never a
		// router visit's: the region shows the same once repaired, and only the mark says it was)
		const { Window } = await import('happy-dom');
		const page = (mark: string) => {
			const w = new Window();
			w.document.write(
				`<html><head><title>t</title></head><body><ogygia-region wake="idle"${mark}><p>hi</p></ogygia-region></body></html>`
			);
			return normalize(w.document as unknown as Document);
		};
		expect(page(' data-og-healed="children"')).toBe(page(''));
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
	// (each entry goes when its fix lands: a regression of a fixed bug fails a run again)
	const excused = (shown: string, fresh: string) =>
		KNOWN.filter((k) => k.applies(shown, fresh)).map((k) => k.issue);

	it("a hole without its page's data is a finding again: #993 and #995 are fixed (gen 175, seed 175003)", () => {
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
		expect(excused(page([]), page(['"p2 data"']))).toEqual([]);
	});

	it('a peer widget missing from the tab is a finding again: #937 is fixed (gen 157)', () => {
		const page = (widget: string[]) =>
			['title: ', '<html>', '  <body>', ...widget.map((l) => `    ${l}`)].join('\n');
		const widget = ['<section data-gen="widget">', '  "w1"'];
		expect(excused(page([]), page(widget))).toEqual([]);
	});

	it("a peer's stylesheet left in the head is a finding again: #966 is fixed (gen 158)", () => {
		const page = (sheet: string[]) =>
			['title: ', '<html>', '  <head>', ...sheet.map((l) => `    ${l}`), '  <body>'].join('\n');
		const sheet = '<link crossorigin="" href="https://peer.test/a.css" rel="stylesheet">';
		expect(excused(page([sheet]), page([]))).toEqual([]);
	});

	it("#1039's sheet link inside a held region, on one side (gen 194, seed 72)", () => {
		const k = KNOWN.find((x) => x.issue === 1039)!;
		const page = (sheet: string[]) =>
			[
				'title: ',
				'<html>',
				'  <body>',
				'    <div data-gen="held-host">',
				'      <ogygia-region data-og-baked="" live="">',
				...sheet.map((l) => `        ${l}`),
				'        <div data-gen="held">',
				'          <span>',
				'            "n3 #0"'
			].join('\n');
		const shown = page([
			'<link data-ogygia-region-css="" href="/_app/immutable/assets/og-region.x.css" rel="stylesheet">'
		]);
		const fresh = page([]);
		expect(k.applies(shown, fresh)).toBe(true);
		expect(k.applies(fresh, fresh)).toBe(false);
		expect(k.forgive(shown, fresh)).toBe(fresh);
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
			skewed_for: () => false
		} as unknown as Parameters<typeof regions_show>[1];
		const found = regions_show(tab, world);
		expect(found?.oracle).toBe('empty-region');
		expect(found?.detail).toContain('entry="e2"');
		expect(found?.detail).not.toContain('entry="e1"');
	});

	it('finds an empty peer region, answered or refused by another deployment: #937 and #1007 are fixed (gen 195, seed 31)', async () => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/p0' });
		w.document.write(
			'<html><body><ogygia-region render="defer" endpoint="/og/frag?slot=1" data-hydrated=""></ogygia-region><ogygia-region render="defer" endpoint="/og/frag?slot=2"></ogygia-region></body></html>'
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
			skewed_for: () => false
		} as unknown as Parameters<typeof regions_show>[1];
		const found = regions_show(tab, world);
		expect(found?.oracle).toBe('empty-region');
		expect(found?.detail).toContain('data-hydrated=""');
		expect(found?.detail.split('\n')).toHaveLength(2);
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

	it("counts one a filed bug explains as known: a hole in a peer's page asks the app's endpoint (#910, gen 196)", async () => {
		const found = await at_rest(
			`<main data-gen="peer-page">${hole('load', 'data-gen-fallback')}</main>`,
			[['/__ogygia__?id=a&exp=1&sig=s', 403]]
		);
		expect(found?.oracle).toBe('known');
		expect(found?.detail).toContain('#910');
		// (one the bug does not explain stays a finding beside it)
		const both = await at_rest(
			`<main data-gen="peer-page">${hole('load', 'data-gen-fallback')}</main>${hole('idle', 'data-gen-fallback')}`
		);
		expect(both?.oracle).toBe('fallback-stands');
	});
});

describe('a live region announces what it shows', () => {
	type Said = [type: 'ogygia:hydrated' | 'ogygia:live', entry: string, tick: number];
	/** A live region showing `tick` of module `entry` (interactive: it has a `wake`), and what a
	 *  listener on the document heard it say, each with what it showed then. */
	const at_rest = async (
		o: { entry: string; tick: number; wake?: boolean; extra?: string; moves?: string },
		said: Said[],
		wire: Array<[string, number | 'dropped']> = []
	) => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/p1' });
		const body = (tick: number) =>
			`<div data-gen="live"><span>n4 tick ${tick}</span><i data-gen-page>${tick}</i>${o.extra ?? ''}</div>`;
		w.document.write(
			`<html><body><div data-gen="live-host"><ogygia-region render="defer" entry="${o.entry}"${o.wake ? ' wake="load"' : ''}>${body(o.tick)}</ogygia-region></div></body></html>`
		);
		const region = w.document.querySelector('ogygia-region') as unknown as Element;
		const heard = new Map<Element, Heard[]>([
			[
				region,
				said.map(([type, entry, tick], i) => ({ type, at: i, entry, shown: `n4 tick ${tick}` }))
			]
		]);
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			documents: 1,
			heard,
			page: {
				mainFrame: {
					url: 'https://app.test/p1',
					document: w.document,
					window: { __ogygia_moves: () => o.moves ?? '' }
				}
			}
		} as unknown as Parameters<typeof live_events>[0];
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
		} as unknown as Parameters<typeof live_events>[1];
		return live_events(tab, world);
	};

	it('passes a region whose every paint was heard: a static tick, then an island mounted and kept alive', async () => {
		expect(await at_rest({ entry: 's4', tick: 5 }, [['ogygia:live', 's4', 5]])).toBeNull();
		expect(
			await at_rest({ entry: 'm4', tick: 4, wake: true }, [
				['ogygia:live', 's4', 2],
				['ogygia:hydrated', 'm4', 3],
				['ogygia:live', 'm4', 3],
				['ogygia:live', 'm4', 4]
			])
		).toBeNull();
	});

	it("finds a kept-alive island's tick nobody heard (core.ts: the keep-alive's ogygia:live)", async () => {
		const found = await at_rest({ entry: 'm4', tick: 4, wake: true }, [
			['ogygia:hydrated', 'm4', 3],
			['ogygia:live', 'm4', 3]
		]);
		expect(found?.oracle).toBe('live-events');
		expect(found?.detail).toContain('n4 tick 4');
	});

	it('finds a mounted island that never said ogygia:hydrated, and one that never said ogygia:live', async () => {
		expect(
			(await at_rest({ entry: 'm4', tick: 3, wake: true }, [['ogygia:live', 'm4', 3]]))?.oracle
		).toBe('live-events');
		expect(
			(await at_rest({ entry: 'm4', tick: 3, wake: true }, [['ogygia:hydrated', 'm4', 3]]))?.oracle
		).toBe('live-events');
		// (another module's mount is not this one's)
		expect(
			(
				await at_rest({ entry: 'm4', tick: 3, wake: true }, [
					['ogygia:hydrated', 'a4', 1],
					['ogygia:live', 'a4', 1],
					['ogygia:live', 'm4', 3]
				])
			)?.oracle
		).toBe('live-events');
	});

	it('waits while a tick is on its way to the screen: swapped in, its island not yet mounted', async () => {
		const hydrating = 'live-region#2 static -> hydrating';
		const said: Said[] = [['ogygia:live', 's4', 2]];
		expect(await at_rest({ entry: 'm4', tick: 3, wake: true, moves: hydrating }, said)).toBeNull();
		expect(
			await at_rest(
				{
					entry: 'm4',
					tick: 3,
					wake: true,
					moves: `${hydrating}\nlive-region#2 hydrating -> live`
				},
				said
			)
		).not.toBeNull();
		expect(
			await at_rest({ entry: 's4', tick: 3, moves: 'region-paint#5 idle -> painting' }, said)
		).toBeNull();
	});

	it('finds a region that showed a tick and said nothing at all', async () => {
		expect((await at_rest({ entry: 's4', tick: 1 }, []))?.oracle).toBe('live-events');
	});

	it("leaves out what is not the tick's: the page's data, a button's own count, a region inside", async () => {
		expect(
			await at_rest(
				{
					entry: 's4',
					tick: 5,
					extra: '<button>pressed 3</button><ogygia-region entry="n9"><p>n9 #2</p></ogygia-region>'
				},
				[['ogygia:live', 's4', 5]]
			)
		).toBeNull();
	});

	it("sets aside an island in a document a fault touched (its file may have failed: it shows the tick's HTML, #942), never a static tick", async () => {
		const failed: Array<[string, 'dropped']> = [['/_app/immutable/m4.js', 'dropped']];
		expect(await at_rest({ entry: 'm4', tick: 3, wake: true }, [], failed)).toBeNull();
		expect((await at_rest({ entry: 's4', tick: 3 }, [], failed))?.oracle).toBe('live-events');
	});
});

describe('a region on screen keeps its styles', () => {
	const at_rest = async (
		head: string,
		body: string,
		wire: Array<[string, number | 'dropped']> = []
	) => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/p1' });
		w.document.write(`<html><head>${head}</head><body>${body}</body></html>`);
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			documents: 1,
			page: { mainFrame: { url: 'https://app.test/p1', document: w.document } }
		} as unknown as Parameters<typeof styled_regions>[0];
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
		} as unknown as Parameters<typeof styled_regions>[1];
		return styled_regions(tab, world);
	};
	const region =
		'<ogygia-region entry="n4"><div class="g4 svelte-abc123"><span class="svelte-abc123">n4</span></div></ogygia-region>';

	it("passes a region whose component's scoped rules are in the head", async () => {
		expect(await at_rest('<style>.g4.svelte-abc123 { border: 0 }</style>', region)).toBeNull();
	});

	it('finds one whose sheet left the head while it stays on screen (core.ts: an answer that never said which sheets it uses)', async () => {
		const found = await at_rest('<style>.other.svelte-zzz999 { border: 0 }</style>', region);
		expect(found?.oracle).toBe('unstyled-region');
		expect(found?.detail).toContain('svelte-abc123');
	});

	it('leaves out an element outside a region, and a document a fault touched (its sheet may have failed)', async () => {
		expect(await at_rest('', '<div class="svelte-abc123">page</div>')).toBeNull();
		expect(await at_rest('', region, [['/_app/immutable/assets/N4.css', 'dropped']])).toBeNull();
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

describe('page rules', () => {
	// (gen 195, seed 97: a changed byte in the reloaded page's HTML made `data-ogygia-region-css`
	// read `data-ogygia-regiontcss`, a marker nobody declared)
	const broken = [
		{
			code: 'rule_markup_known',
			detail: 'the page carries undeclared markers: data-ogygia-regiontcss'
		}
	];
	const tab = (rules: Array<{ code: string; detail: string }>) =>
		({
			realm: 'tab-1#3',
			name: 'tab-1',
			documents: 3,
			page: {
				mainFrame: { url: 'https://app.test/p1', window: { __ogygia_rules: () => rules } }
			}
		}) as unknown as Parameters<typeof page_rules>[0];
	const world = (tampered: boolean) =>
		({
			fired_in: new Map(),
			network: {
				exchanges: [
					{
						id: 1,
						from: 'tab-1#3',
						method: 'GET',
						url: 'https://app.test/p1',
						status: 200,
						cut: false,
						tampered
					}
				]
			}
		}) as unknown as Parameters<typeof page_rules>[1];

	it("a marker a changed byte made is the network's, not the page's", () => {
		expect(page_rules(tab(broken), world(true))).toBeNull();
		expect(page_rules(tab(broken), world(false))?.oracle).toBe('rules');
	});

	it('a changed byte excuses no other rule', () => {
		const drift = [{ code: 'rule_address_bar_drift', detail: 'the address bar is /' }];
		expect(page_rules(tab([...broken, ...drift]), world(true))?.detail).toBe(
			'rule_address_bar_drift: the address bar is /'
		);
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

	it("a changed byte in a JSON answer may be said as the parser's bare message (palaestra seed 204)", () => {
		// (a live query's stream: the remote function's client logs the error's message alone, with
		// no `SyntaxError` before it)
		const json = [
			"error: Expected ':' after property name in JSON at position 11 (line 1 column 12)"
		];
		expect(page_errors(tab(json), world('https://app.test/_app/x.js'))).toBeNull();
		expect(page_errors(tab(json), world('none'))?.oracle).toBe('page-errors');
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

	// (gen 192, seed 19: a router visit's hero image dropped; the DOM library says why only after
	// the element's `error`, on the window's console, so its line carries no reason)
	const image = (status: number | 'dropped') =>
		({
			fired_in: new Map(),
			network: {
				exchanges: [
					{ id: 1, url: 'https://app.test/split-brain', status: 200 },
					{ id: 2, url: 'https://app.test/hero.png', status: 200 },
					{ id: 3, url: 'https://app.test/hero.png', status },
					{ id: 4, url: 'https://app.test/_app/x.js', status: 'dropped' }
				].map((e) => ({ from: 'tab-1#6', method: 'GET', cut: false, tampered: false, ...e }))
			}
		}) as unknown as Parameters<typeof page_errors>[1];
	const failed_image = ['error: <img> /hero.png failed'];

	it('an element whose own download the network failed may say it failed (gen 192, seed 19)', () => {
		expect(page_errors(tab(failed_image), image('dropped'))).toBeNull();
	});

	it('an element that failed though its download came is a finding, whatever else dropped', () => {
		expect(page_errors(tab(failed_image), image(200))?.oracle).toBe('page-errors');
	});

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
