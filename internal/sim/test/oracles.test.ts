// The oracles on the palaestra build: a page at rest keeps ogygia's rules, has no errors, and
// equals a fresh hard load of its URL. (Skipped without `OGYGIA_RULES=1 vite build` there.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { user_click } from '../src/workload.ts';
import type { Heard } from '../src/browser.ts';
import { waste } from '../src/waste.ts';
import { owed_text } from '../src/network.ts';
import {
	document_faulted,
	fallback_stands,
	faulted,
	hydrates_as_sent,
	islands_wake,
	KNOWN,
	known_said,
	Leaks,
	live_events,
	mpa_equivalent,
	gate_open_early,
	no_viewport_wait,
	normalize,
	parsed_first,
	live_regions_out,
	page_errors,
	peer_answers,
	peer_fails_over,
	reshaped_live,
	text_restored,
	page_rules,
	regions_show,
	replicas_as_one,
	styled_regions
} from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

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
		expect([...moving].sort((a, b) => a - b)).toEqual([0, 1]);
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
			`<html><head><title>t</title><script nonce="x">1\x3C/script></head><body>
  <!--[--><p class="a" nonce="y">hi</p><!--]-->
</body></html>`
		);
		expect(normalize(w.document as unknown as Document)).toBe(
			`title: t
<html>
  <head>
    <title>
      "t"
  <body>
    <p class="a">
      "hi"`
		);
	});

	it("reads a peer's replica as its first origin: the replica's files, and its region sheet lifted beside the same file at the first origin (gen 23, seed 22; gen 121, seed 11)", async () => {
		const { Window } = await import('happy-dom');
		const replicas = new Map([['https://peer2.test', 'https://peer.test']]);
		const css = '/_app/immutable/assets/og-region.a.css';
		const page = (head: string, region: string) => {
			const w = new Window({ url: 'https://app.test/p3' });
			w.document.write(
				`<html><head><title>t</title>${head}</head><body><ogygia-region src="${region}/_app/r.js"><link data-ogygia-region-css rel="stylesheet" href="https://peer.test${css}"><p>w</p></ogygia-region></body></html>`
			);
			const doc = w.document as unknown as Document;
			return replicas_as_one(doc, normalize(doc), replicas);
		};
		const fresh = page('', 'https://peer.test');
		expect(page('', 'https://peer2.test')).toBe(fresh);
		expect(
			page(`<link data-ogygia-region-css rel="stylesheet" href="https://peer2.test${css}">`, '')
		).toBe(page('', ''));
		// (the same file lifted at the first origin is ogygia's to keep once: it stays a finding)
		expect(
			page(`<link data-ogygia-region-css rel="stylesheet" href="https://peer.test${css}">`, '')
		).not.toBe(page('', ''));
		// (no replica: as it was)
		const w = new Window({ url: 'https://app.test/' });
		w.document.write('<html><body><p src="https://peer2.test/x">x</p></body></html>');
		const doc = w.document as unknown as Document;
		expect(replicas_as_one(doc, normalize(doc), new Map())).toBe(normalize(doc));
	});

	it("drops a third party's head element, which a client navigation keeps (gen 262, seed 6)", async () => {
		const { Window } = await import('happy-dom');
		const page = (extra: string) => {
			const w = new Window();
			w.document.write(
				`<html><head><title>t</title>${extra}<meta name="a" content="b"></head><body><p>hi</p></body></html>`
			);
			return normalize(w.document as unknown as Document);
		};
		expect(page('<meta data-gen-third-party="">')).toBe(page(''));
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

	it('keeps an address no URL can be made of as it is: a tampered byte in a link (gen 45, seed 32)', async () => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/peer/q0' });
		w.document.write(
			`<html><head><link rel="stylesheet" href="https://peer.tes�/a.css"></head><body></body></html>`
		);
		expect(normalize(w.document as unknown as Document)).toContain(
			'href="https://peer.tes�/a.css"'
		);
	});

	it('reads the base address once: in happy-dom each read walks the document and grows every element (palaestra seed 216 ran out of memory)', async () => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/' });
		w.document.write(
			`<html><head><link rel="stylesheet" href="./a.css"></head><body>${'<p class="a" id="b">x</p>'.repeat(50)}</body></html>`
		);
		const doc = w.document as unknown as Document;
		let reads = 0;
		const root = {
			documentElement: doc.documentElement,
			title: doc.title,
			get baseURI() {
				reads++;
				return doc.baseURI;
			}
		};
		normalize(root);
		expect(reads).toBeLessThanOrEqual(1);
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

	it("drops a reshape pass's first-load mark: a document loaded as one has it, the router's answer of the same page never does (gen 10, seed 10)", async () => {
		const { Window } = await import('happy-dom');
		const page = (head: string) => {
			const w = new Window();
			w.document.write(`<html><head><title>t</title>${head}</head><body><p>hi</p></body></html>`);
			return normalize(w.document as unknown as Document);
		};
		expect(page('<meta name="ogygia-first-load">')).toBe(page(''));
	});

	it("drops a reshape pass's stand-ins sheet: a page the pass failed on goes out as ogygia rendered it, with none (gen 24, seed 5)", async () => {
		const { Window } = await import('happy-dom');
		const page = (head: string) => {
			const w = new Window();
			w.document.write(`<html><head><title>t</title>${head}</head><body><p>hi</p></body></html>`);
			return normalize(w.document as unknown as Document);
		};
		expect(page('<style data-og-stand-ins>:where(og-as){display:inline}</style>')).toBe(page(''));
	});

	it("compares an app web component by its host alone: a server-owned one is the render's on a fresh load and restored in the router's answer (gen 262, seed 3)", async () => {
		const { Window } = await import('happy-dom');
		const page = (body: string) => {
			const w = new Window();
			w.document.write(`<html><head><title>t</title></head><body>${body}</body></html>`);
			return normalize(w.document as unknown as Document);
		};
		const restored = '<x-gen-box data-n="16"><span>n16</span><i>box n16</i></x-gen-box>';
		const rendered =
			'<x-gen-box data-n="16" data-rendered="x-gen-box"><div class="gen-box"><b>box</b><slot><span>n16</span></slot></div></x-gen-box>';
		expect(page(rendered)).toBe(page(restored));
		expect(page('<x-gen-box data-n="1"></x-gen-box>')).not.toBe(page(restored));
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

	it("#1107's island head styles in the order the islands woke (gen 262, seed 25)", () => {
		const k = KNOWN.find((x) => x.issue === 1107)!;
		const style = (n: number) => `    <style data-gen-head="n${n}">
      ".h${n} { color: inherit; }"`;
		const page = (...ns: number[]) => `title:
<html>
  <head>
${ns.map(style).join('\n')}
    <link href="/a.css" rel="stylesheet">
  <body>`;
		expect(k.applies(page(1, 3), page(3, 1))).toBe(true);
		expect(k.forgive(page(1, 3), page(3, 1))).toBe(k.forgive(page(3, 1), page(1, 3)));
		// (the same order, or another island's style missing, is not it)
		expect(k.applies(page(1, 3), page(1, 3))).toBe(false);
		expect(k.applies(page(1, 3), page(3))).toBe(false);
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
	const at_rest = async (
		body: string,
		wire: Array<[string, number | 'dropped']> = [],
		/** A script of the document failed to load (its runtime: none of its holes is ever asked). */
		lacks_a_file = false,
		/** Buggify lost an answer of the document's on the way (`hole.fetch-lost`). */
		lost = false,
		/** The document's batches (`POST /__ogygia__`): the holes each asked for, and how it went. */
		batches: Array<{ holes: string[]; status: number | 'dropped'; cut?: boolean }> = []
	) => {
		const { Window } = await import('happy-dom');
		// (the simulator's viewport: src/layout.ts)
		const w = new Window({ url: 'https://app.test/p1', width: 1280, height: 720 });
		w.document.write(`<html><body>${body}</body></html>`);
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			documents: 1,
			page: { mainFrame: { url: 'https://app.test/p1', document: w.document } }
		} as unknown as Parameters<typeof fallback_stands>[0];
		const world = {
			fired_in: new Map(lost ? [['tab-1#1', new Set(['hole.fetch-lost'])]] : []),
			browsers: { lacks_a_file: () => lacks_a_file },
			network: {
				exchanges: [
					...wire.map(([url, status]) => ({
						from: 'tab-1#1',
						method: 'GET',
						url: `https://app.test${url}`,
						status,
						cut: false
					})),
					...batches.map((b) => ({
						from: 'tab-1#1',
						method: 'POST',
						url: 'https://app.test/__ogygia__',
						status: b.status,
						cut: b.cut ?? false,
						holes: b.holes
					}))
				].map((e, i) => ({ id: i + 1, tampered: false, redirected: false, ...e }))
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

	// generated app 12 (real shapes), seed 22: a dropped chunk of the runtime, and the peer page's
	// load hole was never asked: the runtime never ran, as runtime_load_failed says
	it('passes one never asked for in a document whose runtime failed to load', async () => {
		const chunk: [string, 'dropped'] = ['/_app/immutable/chunks/x.js', 'dropped'];
		expect(await at_rest(hole('load', 'data-gen-fallback'), [chunk], true)).toBeNull();
	});

	// generated app 208, seed 120: a nested hole of a hidden tab's peer page, its three tries each
	// lost by buggify before a request went out, so the wire never saw it asked
	it('passes one never seen asked in a document whose answers buggify lost (a lost answer leaves no exchange)', async () => {
		expect(await at_rest(hole('load', 'data-gen-fallback'), [], false, true)).toBeNull();
	});

	// frame-nav's release mutant (a batch's undelivered reservations never released) survived gens
	// 10, 191, 192, 193 and palaestra: every faulted document that sent a batch was set aside
	it("finds a hole a failed batch asked for that never asked on its own (a batch's unreleased part survived)", async () => {
		const standing = hole('load', 'data-gen-fallback');
		const failed = { holes: ['/__ogygia__?id=a'], status: 200, cut: true };
		const dropped = { holes: ['/__ogygia__?id=a'], status: 'dropped' as const };
		expect((await at_rest(standing, [], false, false, [failed]))?.oracle).toBe('fallback-stands');
		expect((await at_rest(standing, [], false, false, [dropped]))?.oracle).toBe('fallback-stands');
		// (released, it asked on its own, and that failed too: a fault's)
		const own: [string, 'dropped'] = ['/__ogygia__?id=a&exp=1&sig=s', 'dropped'];
		expect(await at_rest(standing, [own], false, false, [failed])).toBeNull();
		// (a whole batch that named it, in a document a fault touched elsewhere: it was answered)
		const other: [string, 'dropped'] = ['/_app/immutable/x.js', 'dropped'];
		const whole = { holes: ['/__ogygia__?id=a'], status: 200 };
		expect(await at_rest(standing, [other], false, false, [whole])).toBeNull();
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

	// (a block 1000 px tall puts what follows it below the 720 px viewport)
	const fold = (px: number) => `<div style="height: ${px}px"></div>`;

	it('finds a visible hole its margin reaches still on its fallback, and passes one beyond it', async () => {
		const visible = (margin: string) =>
			`<ogygia-region render="defer" when="visible" margin="${margin}" endpoint="/__ogygia__?id=a"><p data-gen-fallback>loading n1…</p></ogygia-region>`;
		expect((await at_rest(fold(800) + visible('200px')))?.oracle).toBe('fallback-stands');
		expect(await at_rest(fold(1000) + visible('200px'))).toBeNull();
	});

	it("finds a hole whose prefetch is owed never warmed (a mutant that dropped the prefetch's margin survived)", async () => {
		const warm = (prefetch: string, margin = '') =>
			`<ogygia-region render="defer" when="interaction" prefetch="${prefetch}"${margin ? ` margin="${margin}"` : ''} endpoint="/__ogygia__?id=a"><p data-gen-fallback>loading n1…</p></ogygia-region>`;
		const cold = await at_rest(fold(800) + warm('visible', '200px'));
		expect(cold?.oracle).toBe('fallback-stands');
		expect(cold?.detail).toContain('never warmed');
		expect((await at_rest(warm('idle')))?.oracle).toBe('fallback-stands');
		// (warmed: its endpoint was asked; and one beyond its margin owes nothing yet)
		expect(await at_rest(warm('idle'), [['/__ogygia__?id=a&exp=1&sig=s', 200]])).toBeNull();
		expect(await at_rest(fold(1000) + warm('visible', '200px'))).toBeNull();
	});
});

describe('an island that wakes on its own is awake', () => {
	/** `wire`: the document's requests, each `[url, status]`; `hidden`: the tab is behind another. */
	const at_rest = async (
		body: string,
		wire: Array<[string, number | 'dropped']> = [],
		hidden = false
	) => {
		const { Window } = await import('happy-dom');
		// (the simulator's viewport: src/layout.ts)
		const w = new Window({ url: 'https://app.test/p1', width: 1280, height: 720 });
		w.document.write(`<html><body>${body}</body></html>`);
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			documents: 1,
			hidden,
			page: { mainFrame: { url: 'https://app.test/p1', document: w.document } }
		} as unknown as Parameters<typeof islands_wake>[0];
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
				})),
				busy_for: () => false
			},
			browsers: { lacks_a_file: () => false },
			skewed_for: () => false
		} as unknown as Parameters<typeof islands_wake>[1];
		return islands_wake(tab, world);
	};
	const island = (wake: string, hydrated = false) =>
		`<ogygia-region wake="${wake}" entry="/_app/n1.js"${hydrated ? ' data-hydrated=""' : ''}><div data-gen="island">n1</div></ogygia-region>`;

	it('finds a load or idle island still asleep at rest (a mutant whose wakes never ran survived)', async () => {
		const load = await at_rest(island('load'));
		expect(load?.oracle).toBe('islands-wake');
		expect(load?.detail).toContain('wake="load"');
		expect((await at_rest(island('idle')))?.oracle).toBe('islands-wake');
	});

	it('passes an awake one, one waiting for the visitor or the screen, and one in a faulted document', async () => {
		expect(await at_rest(island('load', true))).toBeNull();
		expect(await at_rest(island('interaction'))).toBeNull();
		expect(await at_rest(fold(1000) + island('visible'))).toBeNull();
		// (one in a lake inside an island still waiting for the screen waits with it)
		expect(
			await at_rest(
				`${fold(1000)}<ogygia-region wake="visible" entry="/_app/n3.js"><ogygia-region wake="none">${island('load')}</ogygia-region></ogygia-region>`
			)
		).toBeNull();
		expect(await at_rest(island('load'), [['/_app/n1.js', 'dropped']])).toBeNull();
		// (and one in a lake whose host never hydrates: a held region's baked markup)
		const lake = `<ogygia-region wake="none">${island('load')}</ogygia-region>`;
		expect(await at_rest(`<ogygia-region live data-og-baked>${lake}</ogygia-region>`)).toBeNull();
		// (but one in a lake whose host island woke is owed its wake)
		expect(
			(
				await at_rest(
					`<ogygia-region wake="load" entry="/_app/n3.js" data-hydrated>${lake}</ogygia-region>`
				)
			)?.oracle
		).toBe('islands-wake');
	});

	// (a block 1000 px tall puts what follows it below the 720 px viewport)
	const fold = (px: number) => `<div style="height: ${px}px"></div>`;
	const visible = (margin?: string) =>
		`<ogygia-region wake="visible" entry="/_app/n2.js"${margin ? ` margin="${margin}"` : ''}><div data-gen="island">n2</div></ogygia-region>`;

	it('finds a visible island on screen still asleep, and one below the fold its margin reaches (a mutant that dropped the margin survived)', async () => {
		const on = await at_rest(visible());
		expect(on?.oracle).toBe('islands-wake');
		expect(on?.detail).toContain('wake="visible"');
		// (800 px down: 80 px below the fold, inside a 200 px margin)
		expect((await at_rest(fold(800) + visible('200px')))?.oracle).toBe('islands-wake');
		// (a margin in % is of the viewport's height: 50% is 360 px)
		expect((await at_rest(fold(1000) + visible('50%')))?.oracle).toBe('islands-wake');
	});

	it('passes a visible island below the fold and its margin, and one in a tab behind another', async () => {
		expect(await at_rest(fold(1000) + visible())).toBeNull();
		expect(await at_rest(fold(1000) + visible('200px'))).toBeNull();
		expect(await at_rest(visible(), [], true)).toBeNull();
		// (an island inside one below the fold waits with it)
		expect(
			await at_rest(
				`${fold(1000)}<ogygia-region wake="visible" entry="/_app/n3.js">${island('load')}</ogygia-region>`
			)
		).toBeNull();
	});

	it('owes a media island its wake only while its query matches (the viewport is 1280 px wide)', async () => {
		expect((await at_rest(island('(min-width: 800px)')))?.oracle).toBe('islands-wake');
		expect(await at_rest(island('(max-width: 600px)'))).toBeNull();
	});

	it("owes a hole's island its wake once the hole's own answer is owed", async () => {
		const hole = (when: string, wake: string) =>
			`<ogygia-region entry="/_app/n4.js" render="defer" when="${when}" wake="${wake}" endpoint="/_ogygia/r/n4"><div data-gen="hole">n4</div></ogygia-region>`;
		expect((await at_rest(hole('load', 'load')))?.oracle).toBe('islands-wake');
		expect(await at_rest(hole('interaction', 'load'))).toBeNull();
		expect(await at_rest(fold(1000) + hole('visible', 'load'))).toBeNull();
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

	it("leaves out a nested remote query's own waiting or failed line: its answer comes later, no tick of this region's (gen 650)", async () => {
		for (const line of [
			'<span data-gen-pending>connecting n13…</span>',
			'<span data-gen-error>n13 failed</span>'
		])
			expect(
				await at_rest({ entry: 's4', tick: 5, extra: `<div data-gen="live-host">${line}</div>` }, [
					['ogygia:live', 's4', 5]
				])
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

	// (router.build-throws, aimed on gen 191: the navigation hands off and reports the build's throw,
	// as report_thrown does any app error; every seed failed on its own point's words)
	it("a buggify point's own throw, reported by the document it fired in, is the point's", () => {
		const thrown = ['Error: router.build-throws'];
		const w = world('none') as unknown as { fired_in: Map<string, Set<string>> };
		w.fired_in.set('tab-1#6', new Set(['router.build-throws']));
		const fired = w as unknown as Parameters<typeof page_errors>[1];
		expect(page_errors(tab(thrown), fired)).toBeNull();
		// (another point's words, or the same words where it did not fire, are still errors)
		expect(page_errors(tab(['Error: router.commit-throws']), fired)?.oracle).toBe('page-errors');
		expect(page_errors(tab(thrown), world('none'))?.oracle).toBe('page-errors');
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

	it("a mounted peer page that failed only because the peer's first origin was down is no fault: the app owes the next origin's answer (a mutant that never asked it survived)", () => {
		const world = (hop: Record<string, unknown>) =>
			({
				fired_in: new Map(),
				network: {
					exchanges: [
						{ id: 1, from: 'tab-0#2', url: 'https://app.test/peer/q0', status: 502 },
						{
							id: 2,
							from: 'server-1',
							for: 'tab-0#2',
							url: 'https://peer.test/og/fragment/page?path=%2Fq0',
							...hop
						}
					].map((e) => ({ method: 'GET', cut: false, tampered: false, redirected: false, ...e }))
				}
			}) as unknown as World;
		const t = {
			realm: 'tab-0#2',
			name: 'tab-0',
			documents: 2,
			page: { mainFrame: { url: 'https://app.test/peer/q0' } }
		} as unknown as Parameters<typeof faulted>[1];
		expect(faulted(world({ status: 503, down: true }), t)).toBe(false);
		expect(faulted(world({ status: 'dropped' }), t)).toBe(true);
		expect(faulted(world({ status: 503, down: true, method: 'POST' }), t)).toBe(true);
		// (the next origin's answer held past the peer's timeout: the app's 504 is its own, gen 23, seed 80)
		const held = world({ status: 503, down: true });
		(held.network.exchanges as unknown as Array<Record<string, unknown>>).push({
			id: 3,
			from: 'server-1',
			for: 'tab-0#2',
			method: 'GET',
			url: 'https://peer2.test/og/fragment/page?path=%2Fq0',
			status: 200,
			stalled: true,
			cut: false,
			tampered: false,
			redirected: false
		});
		expect(faulted(held, t)).toBe(true);
		// (a hole's answer of the document's that failed is judged by its own story, not the page's)
		const hole = world({ status: 503, down: true });
		(hole.network.exchanges as unknown as Array<Record<string, unknown>>).unshift({
			id: 0,
			from: 'tab-0#2',
			method: 'GET',
			url: 'https://app.test/peer/q0',
			status: 200,
			cut: false,
			tampered: false,
			redirected: false
		});
		expect(faulted(hole, t)).toBe(true);
	});
});

describe("a reshaped page's text comes back as it was", () => {
	const judged = async (body: string, owes: string[] | undefined) => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/p0' });
		w.document.write(`<html><body>${body}</body></html>`);
		const tab = {
			realm: 'tab-0#1',
			name: 'tab-0',
			page: { mainFrame: { url: 'https://app.test/p0', document: w.document } }
		} as unknown as Parameters<typeof text_restored>[0];
		const world = {
			network: {
				exchanges: [
					{
						id: 1,
						from: 'tab-0#1',
						method: 'GET',
						url: 'https://app.test/p0',
						status: 200,
						cut: false,
						tampered: false,
						restore_owes: owes
					}
				]
			}
		} as unknown as World;
		return text_restored(tab, world);
	};

	it('reads the originals off the marks', () => {
		expect(owed_text('<p><!--og-t 1.0 "\\n  r3\\n"-->r3</p><!--og-t 1.1-->')).toEqual(['\n  r3\n']);
		expect(owed_text('<p>none</p>')).toBeUndefined();
	});

	it('finds trimmed text left trimmed (a restore that never put its text back survived), and passes it put back or changed since', async () => {
		expect((await judged('<x-gen-box><b> pad </b></x-gen-box>', ['  pad  ']))?.oracle).toBe(
			'text-restored'
		);
		expect(await judged('<x-gen-box><b>  pad  </b></x-gen-box>', ['  pad  '])).toBeNull();
		expect(await judged('<x-gen-box><b>r4</b></x-gen-box>', ['  pad  '])).toBeNull();
		expect(await judged('<x-gen-box> r3 </x-gen-box>', undefined)).toBeNull();
	});
});

describe('a peer fails over, and only then', () => {
	const hop = (id: number, origin: string, at: number, more: Record<string, unknown> = {}) => ({
		id,
		from: 'server-0',
		for: 'tab-0#1',
		method: 'GET',
		url: `${origin}/og/fragment/w0?label=r0`,
		at,
		status: 200,
		cut: false,
		tampered: false,
		redirected: false,
		...more
	});
	const judged = (...exchanges: Array<Record<string, unknown>>) =>
		peer_fails_over(
			{
				replicas: new Map([['https://peer2.test', 'https://peer.test']]),
				network: {
					exchanges: [
						{
							id: 0,
							from: 'tab-0#1',
							method: 'GET',
							url: 'https://app.test/p0',
							at: 0,
							status: 200,
							cut: false
						},
						...exchanges
					]
				}
			} as unknown as World,
			0
		);
	const first = 'https://peer.test';
	const replica = 'https://peer2.test';

	it('finds a down first origin whose replica was not asked (a mutant that kept the 500 survived)', () => {
		expect(judged(hop(1, first, 10, { status: 500, down: true }))?.oracle).toBe('peer-failover');
		expect(judged(hop(1, first, 10, { status: 503, down: true }), hop(2, replica, 12))).toBeNull();
	});

	it('finds the replica asked after the first origin answered (a mutant that asked every origin survived)', () => {
		expect(judged(hop(1, first, 10), hop(2, replica, 12))?.oracle).toBe('peer-failover');
		expect(judged(hop(1, first, 10))).toBeNull();
	});

	it('passes the replica asked once the first origin gave nothing: past its timeout, or for another read of the address (gen 121, seeds 6 and 103)', () => {
		expect(judged(hop(1, first, 10), hop(2, replica, 5010))).toBeNull();
		expect(judged(hop(1, first, 10), hop(2, first, 4000), hop(3, replica, 5010))).toBeNull();
		expect(judged(hop(1, first, 10, { stalled: true }), hop(2, replica, 12))).toBeNull();
		expect(judged(hop(1, first, 10, { status: 'dropped' }), hop(2, replica, 12))).toBeNull();
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
		d.documentElement.innerHTML = '<head><title>t</title></head><body><p>hi</p></body>';
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

	it('a text made from the time of its render is not state, in a run with no delay fault', async () => {
		// (two reference loads with no delay fault take the same time, to the ms: a stamp made of
		// `performance.now()` agreed on both and was never masked. The tab's own load, slower by a
		// buggified flight or a stall, showed another: palaestra seed 20004, /delta/b's DeltaNav)
		const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('alice');
			const tab = world.tab(v);
			await world.go(tab, 'goto', '/delta/b');
			await world.quiesce();
			const doc = tab.page.mainFrame.document as unknown as Document;
			const stamp = doc.querySelector('[data-delta-stamp]')!;
			// (the same page, rendered a few ms later than a reference load)
			stamp.textContent = `nav-server-stamp:${Number(stamp.textContent!.split(':')[1]) + 3000}`;
			expect(await mpa_equivalent(world, v, tab)).toBeNull();
		} finally {
			await world.end();
		}
	});

	it("the fresh load carries the visitor's httpOnly cookies too", async () => {
		// (Kit's `cookies.set` is httpOnly by default: the reference load was sent without the locale
		// a command had set, and showed the other language; palaestra seed 20004, /header-refresh)
		const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('alice');
			const tab = world.tab(v);
			await world.go(tab, 'goto', '/header-refresh');
			await world.quiesce();
			const page = tab.page.mainFrame.document as unknown as Document;
			user_click(page.querySelector('[data-hl-switch]')!);
			await world.quiesce();
			await world.go(tab, 'reload');
			await world.quiesce();
			const doc = tab.page.mainFrame.document as unknown as Document;
			expect(doc.querySelector('[data-hl-header]')!.getAttribute('data-locale')).toBe('fr');
			expect(await mpa_equivalent(world, v, tab)).toBeNull();
		} finally {
			await world.end();
		}
	});
});

describe.skipIf(!built)('a warning a filed bug says', () => {
	it("is the bug's, not waste: /data's derived_inert is upstream (#1079)", async () => {
		// (a remote query in {#await} in a boundary, beside another async boundary, warns on a plain
		// load with no ogygia at all; waste-b320c6)
		const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			await world.go(tab, 'goto', '/data');
			await world.quiesce();
			expect(waste(world, tab)).toEqual({
				oracle: 'known',
				detail: `https://app.test/data: #1079 (Svelte's async mode reads a remote query's derived after its effect ended)`
			});
		} finally {
			await world.end();
		}
	});
});

describe('what a filed bug says', () => {
	it("is #1158's: the AbortError of a batch called off while its body came, nobody listening", () => {
		const said = known_said([
			'unhandled: AbortError: The operation was aborted.',
			'unhandled: TypeError: something else'
		]);
		expect(said.known.map((k) => k.issue)).toEqual([1158]);
		expect(said.left).toEqual(['unhandled: TypeError: something else']);
	});
});

describe('a document nobody has looked at', () => {
	const tab = (moves: string, o: { hidden?: boolean; seen?: boolean } = {}) =>
		({
			realm: 'tab-1#2',
			hidden: o.hidden ?? true,
			seen: new Set(o.seen ? ['tab-1#2'] : []),
			page: {
				mainFrame: { url: 'https://app.test/p1', window: { __ogygia_moves: () => moves } }
			}
		}) as unknown as Parameters<typeof no_viewport_wait>[0];
	const waited = 'hydrate-drain#1 queued -> idle\nhydrate-drain#1 idle -> waiting';

	it('never holds its islands for a viewport it does not have (schedule.ts: a hidden document skips the snapshot and the hold)', () => {
		expect(no_viewport_wait(tab('hydrate-drain#1 idle -> queued'))?.oracle).toBeUndefined();
		const found = no_viewport_wait(tab(waited));
		expect(found?.oracle).toBe('viewport-wait');
		expect(found?.detail).toContain('https://app.test/p1');
	});

	it("opens no island's gate before the document is parsed (schedule.ts: the paint gate waits for DOMContentLoaded)", () => {
		// (a click before it is parsed only marks the gate touched; it opens after the paint all the same)
		expect(gate_open_early('critical-gate#1 fresh -> touched')).toBe(false);
		expect(
			gate_open_early('hydrate-drain#1 idle -> queued\ncritical-gate#1 fresh -> settled')
		).toBe(true);
		expect(gate_open_early('critical-gate#1 fresh -> waiting')).toBe(true);
		const t = (early: string | null) =>
			({
				page: { mainFrame: { url: 'https://app.test/p1' } },
				early_gate: early
			}) as unknown as Parameters<typeof parsed_first>[0];
		expect(parsed_first(t(null))).toBeNull();
		expect(parsed_first(t('https://app.test/p1'))?.oracle).toBe('paint-gate');
	});

	it('leaves out a document that was shown, or is shown now: it had a viewport to wait for', () => {
		expect(no_viewport_wait(tab(waited, { seen: true }))).toBeNull();
		expect(no_viewport_wait(tab(waited, { hidden: false }))).toBeNull();
	});
});

describe("a mounted peer's page answers as the peer did", () => {
	/** `wire`: the tab's requests and the server's hops for its document, each `[url, status, for?]`. */
	const judged = async (
		body: string,
		wire: Array<[string, number | 'dropped', string?]> = [],
		at = '/',
		mount: 'router' | 'kit' = 'kit'
	) => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: `https://app.test${at}` });
		w.document.write(`<html><body>${body}</body></html>`);
		await w.happyDOM.waitUntilComplete();
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			documents: 1,
			page: { mainFrame: { url: `https://app.test${at}`, document: w.document } }
		} as unknown as Parameters<typeof peer_answers>[0];
		const world = {
			fired_in: new Map(),
			network: {
				exchanges: wire.map(([url, status, hop], i) => ({
					id: i + 1,
					from: hop === undefined ? 'tab-1#1' : 'server-0',
					...(hop === undefined ? {} : { for: hop }),
					method: 'GET',
					url: hop === undefined ? `https://app.test${url}` : `https://peer.test${url}`,
					status,
					cut: false,
					tampered: false,
					redirected: false
				}))
			}
		} as unknown as Parameters<typeof peer_answers>[1];
		return peer_answers(tab, world, 0, mount);
	};

	it("finds a page the peer lacks answered as found, and one that moved answered where it was (a mutant that lost the peer's status survived)", async () => {
		expect((await judged('', [['/peer/gone', 200]]))?.oracle).toBe('peer-answers');
		expect((await judged('', [['/peer/moved', 200]]))?.oracle).toBe('peer-answers');
		expect(await judged('', [['/peer/gone', 404]])).toBeNull();
		expect(await judged('', [['/peer/moved', 307]])).toBeNull();
	});

	it("finds one of the peer's own pages answered as a redirect (a mutant that made every exposed page a redirect survived)", async () => {
		expect((await judged('', [['/peer/q0', 307]]))?.oracle).toBe('peer-answers');
		expect((await judged('', [['/peer/q12', 404]]))?.oracle).toBe('peer-answers');
		expect(await judged('', [['/peer/q0', 200]])).toBeNull();
		expect(await judged('', [['/peer/q0/deeper', 307]])).toBeNull();
	});

	it('finds one the peer refuses not answered as refused (a mutant that took a 400 for a redirect, or for no error, survived)', async () => {
		expect((await judged('', [['/peer/bad', 200]], '/peer/bad'))?.oracle).toBe('peer-answers');
		expect((await judged('', [['/peer/bad', 303]], '/peer/bad'))?.oracle).toBe('peer-answers');
		expect(await judged('', [['/peer/bad', 400]], '/peer/bad')).toBeNull();
	});

	it("finds one of the peer's own pages answered 200 showing none of it (a mutant that made every exposed page an empty redirect survived), and passes the app's own 504 (gen 23, seed 38)", async () => {
		const page = '<main data-gen="peer-page"><h1>peer /q0</h1></main>';
		expect((await judged('<p>moved</p>', [['/peer/q0', 200]], '/peer/q0'))?.oracle).toBe(
			'peer-answers'
		);
		expect(await judged(page, [['/peer/q0', 200]], '/peer/q0')).toBeNull();
		// (reached by a client navigation: it may be mid-way, and is not judged)
		expect(await judged('<p>moved</p>', [['/p0', 200]], '/peer/q0')).toBeNull();
		// (the peer's body came past its timeout: the app's 504 says its own words)
		expect(
			await judged(
				'{"error":"This section is temporarily unavailable.","status":504}',
				[
					['/peer/q0', 504],
					['/og/fragment/page?path=/q0', 200, 'tab-1#1']
				],
				'/peer/q0'
			)
		).toBeNull();
	});

	it('finds, on a Kit mount, a page the peer lacks saying nothing (a mutant that lost the message survived)', async () => {
		// (reached by a client navigation: it may be mid-way, and is not judged)
		expect(await judged('<h1>404</h1><p></p>', [['/p0', 200]], '/peer/gone')).toBeNull();
		expect((await judged('<h1>404</h1><p></p>', [['/peer/gone', 404]], '/peer/gone'))?.oracle).toBe(
			'peer-answers'
		);
		expect(
			await judged('<h1>404</h1><p>not found</p>', [['/peer/gone', 404]], '/peer/gone')
		).toBeNull();
		expect(
			await judged(
				'<h1>404</h1><p>This section is unavailable.</p>',
				[['/peer/gone', 404]],
				'/peer/gone'
			)
		).toBeNull();
		// (a server router's mount shows the peer's own not-found page, whatever it says)
		expect(
			await judged('<p>router did not match</p>', [['/peer/gone', 404]], '/peer/gone', 'router')
		).toBeNull();
		// (its hop to the peer failed: what it shows is the app's own)
		expect(
			await judged(
				'<p>502</p>',
				[
					['/og/fragment/page?path=/q0', 'dropped', 'tab-1#1'],
					['/peer/q0', 502]
				],
				'/peer/q0'
			)
		).toBeNull();
	});

	it("finds one of the peer's own pages answered 5xx though the peer gave it whole and in time (a mutant that made every exposed page a redirect survived)", async () => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/peer/q0' });
		w.document.write('<html><body><p>500</p></body></html>');
		const tab = {
			realm: 'tab-1#1',
			name: 'tab-1',
			documents: 1,
			page: { mainFrame: { url: 'https://app.test/peer/q0', document: w.document } }
		} as unknown as Parameters<typeof peer_answers>[0];
		const world = (hop: Record<string, unknown>) =>
			({
				fired_in: new Map(),
				network: {
					exchanges: [
						{ id: 1, from: 'tab-1#1', url: 'https://app.test/peer/q0', at: 0, status: 500 },
						{
							id: 2,
							from: 'server-0',
							for: 'tab-1#1',
							url: 'https://peer.test/og/fragment/page?path=%2Fq0',
							at: 10,
							status: 200,
							ended_at: 40,
							...hop
						}
					].map((e) => ({ method: 'GET', cut: false, tampered: false, redirected: false, ...e }))
				}
			}) as unknown as Parameters<typeof peer_answers>[1];
		expect(peer_answers(tab, world({}), 0)?.oracle).toBe('peer-answers');
		// (past the deadline, or held on the way: the app's 5xx is its own)
		expect(peer_answers(tab, world({ ended_at: 6000 }), 0)).toBeNull();
		expect(peer_answers(tab, world({ stalled: true }), 0)).toBeNull();
		expect(peer_answers(tab, world({ status: 503 }), 0)).toBeNull();
	});

	it("passes one the network failed, or whose hop to the peer failed: the app's answer for it is its own", async () => {
		expect(await judged('', [['/peer/gone', 'dropped']])).toBeNull();
		expect(await judged('', [['/peer/gone', 502]])).toBeNull();
		expect(
			await judged('', [
				['/og/fragment/page?path=/gone', 'dropped', 'tab-1#1'],
				['/peer/gone', 200]
			])
		).toBeNull();
	});

	it("finds a peer's page that shows another visitor than the app's (a mutant that dropped the claims survived), and passes the app's", async () => {
		expect((await judged('<p data-gen-who></p>', [], '/peer/who'))?.oracle).toBe('peer-answers');
		expect(await judged('<p data-gen-who>visitor</p>', [], '/peer/who')).toBeNull();
	});
});
