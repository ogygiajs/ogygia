// A CLIENT NAVIGATION'S EDGES (runtime/router-nav.ts): scroll and its hold on a back step, the
// head's order and policy tags, the sheets it waits for, its hole batch, and the soft refresh.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { scope } from '@ogygia/machine';
import { it_with_network_routes } from './_browsers.ts';
import { history_room } from './_history-budget.ts';
import { in_head } from './_in-head.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { connected_regions } from '../../src/runtime/connected.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { hold_scroll } from '../../src/runtime/router-nav.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { slots } from '../../src/runtime/slots.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		hold_downloads(path: string): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const real_fetch = window.fetch;
const real_report = window.reportError;
const real_vt = document.startViewTransition;
const home = location.href;
const home_head = [...document.head.children];

type Page = {
	head?: string;
	body: string;
	marker?: string;
	gate?: Promise<unknown>;
	landed?: string;
};
let pages: Record<string, Page> = {};
const fetched: string[] = [];

function serve() {
	window.fetch = async (input: RequestInfo | URL) => {
		const url = new URL(String(input instanceof Request ? input.url : input), location.href);
		fetched.push(url.pathname);
		const page = pages[url.pathname];
		if (!page) return new Response('', { status: 404 });
		await page.gate;
		const res = new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="${page.marker ?? 'plain'}">${page.head ?? ''}</head><body>${page.body}</body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
		if (page.landed) {
			const landed = new URL(page.landed, location.href).href;
			Object.defineProperty(res, 'redirected', { value: true });
			Object.defineProperty(res, 'url', { value: landed });
		}
		return res;
	};
}

function gate(): { wait: Promise<void>; open: () => void } {
	let open = () => {};
	const wait = new Promise<void>((resolve) => (open = resolve));
	return { wait, open };
}

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const TALL = '<div style="height: 6000px"></div>';

let r: SpaRouter;
let handed: string[];

beforeEach(async () => {
	await history_room();
	link_boot();
	install_morph();
	pages = {};
	fetched.length = 0;
	handed = [];
	document.body.innerHTML = '<p>first</p>';
	runtime_session.adopt_document_head();
	prepare_spa_document();
	window.reportError = () => {};
	serve();
	r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.pathname);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
});
afterEach(() => {
	window.fetch = real_fetch;
	window.reportError = real_report;
	document.startViewTransition = real_vt;
	for (const el of Array.from(document.head.children)) if (!home_head.includes(el)) el.remove();
	document.head.append(...home_head.filter((el) => !el.isConnected));
	history.replaceState(null, '', home);
	document.body.innerHTML = '';
	document.documentElement.style.overflowAnchor = '';
	scrollTo(0, 0);
});

async function go(path: string, opts: Parameters<SpaRouter['navigate']>[1] = {}) {
	await r.navigate(new URL(path, location.href), opts);
	await expect.poll(() => r.nav.now.kind, { timeout: 5_000 }).toBe('idle');
	expect(handed).toEqual([]);
}

/** A page-owned head node, as the server sent it. */
function owned(html: string): Element {
	const t = document.createElement('template');
	t.innerHTML = html;
	const el = t.content.firstElementChild!;
	document.head.append(el);
	runtime_session.claim_page_head(el);
	return el;
}

test('a commit that throws under a view transition skips the transition', async () => {
	let skipped = 0;
	document.startViewTransition = ((update: () => void) => {
		update();
		return {
			ready: Promise.resolve(),
			finished: Promise.resolve(),
			updateCallbackDone: Promise.resolve(),
			skipTransition: () => void skipped++
		};
	}) as never;
	const g = globalThis as { __og_restore_adopt?: () => void };
	g.__og_restore_adopt = () => {
		throw new Error('adopt broke');
	};
	pages['/rn-vt-throws'] = { marker: '', body: '<p>next</p>' };
	try {
		await r.navigate(new URL('/rn-vt-throws', location.href));
		await expect.poll(() => handed).toEqual(['/rn-vt-throws']);
	} finally {
		delete g.__og_restore_adopt;
	}
	expect(skipped).toBe(1);
});

test('a navigation that replaces the entry keeps the scroll where it is', async () => {
	document.body.innerHTML = `<p>first</p>${TALL}`;
	scrollTo(0, 300);
	pages['/rn-replace'] = { body: `<p>next</p>${TALL}` };
	await go('/rn-replace', { replace: true });
	expect(scrollY).toBeCloseTo(300, 0);
});

test('a back step puts its page where the visitor left it', async () => {
	pages['/rn-pop-scroll'] = { body: `<p>back</p>${TALL}` };
	await go('/rn-pop-scroll', {
		push: false,
		type: 'popstate',
		pop: {
			id: 'rn-pop-scroll',
			url: new URL('/rn-pop-scroll', location.href),
			scroll: { x: 0, y: 700 },
			focus: null
		}
	});
	expect(scrollY).toBeCloseTo(700, 0);
});

test('the new page’s preload links are read once it is in', async () => {
	const scan = vi.spyOn(r, 'scan_preload_links');
	pages['/rn-scan'] = { body: '<a href="/x" data-sveltekit-preload-data="eager">x</a>' };
	await go('/rn-scan');
	expect(scan).toHaveBeenCalledTimes(1);
});

test('a kept island’s head copies are retired once the swap has settled which islands stayed', async () => {
	const retire = vi.spyOn(runtime_session, 'retire_page_head_copies');
	pages['/rn-retire'] = { body: '<p>next</p>' };
	await go('/rn-retire');
	expect(retire).toHaveBeenCalled();
	retire.mockRestore();
});

test('a region inside a shadow root makes the navigation a whole-body swap', async () => {
	const host = document.createElement('div');
	const root = host.attachShadow({ mode: 'open' });
	const inner = document.createElement('ogygia-region');
	root.append(inner);
	document.body.append(host);
	const life = scope();
	connected_regions.add(inner, life);
	let reconciled: boolean | undefined;
	slots.hooks = { navigated: (e) => void (reconciled = e.reconciled) };
	pages['/rn-shadow'] = { body: '<p>next</p>' };
	try {
		await go('/rn-shadow');
	} finally {
		slots.hooks = undefined;
		life.close();
	}
	expect(reconciled).toBe(false);
});

test('an SVG <title> in the next page’s body is no page title: the page gets no <title>', async () => {
	pages['/rn-svg-title'] = { body: '<svg><title>icon</title></svg>' };
	await go('/rn-svg-title');
	expect(document.head.querySelectorAll('title')).toHaveLength(0);
});

test('the runtime’s own module script and a dev server sheet stay across a page that does not list them', async () => {
	const script = owned(
		'<script type="module" data-ogygia-runtime src="data:text/javascript,void%200"></script>'
	);
	const sheet = owned(
		'<link rel="stylesheet" href="data:text/css," data-vite-dev-id="/src/a.css">'
	);
	pages['/rn-keep'] = { body: '<p>next</p>' };
	await go('/rn-keep');
	expect(script.isConnected).toBe(true);
	expect(sheet.isConnected).toBe(true);
});

test('head policy tags of the next page never go in', async () => {
	pages['/rn-deny'] = {
		head: '<meta http-equiv="refresh" content="999;url=/elsewhere"><base href="/evil/">',
		body: '<p>next</p>'
	};
	await go('/rn-deny');
	expect(document.head.querySelector('meta[http-equiv="refresh"]')).toBe(null);
	expect(document.head.querySelector('base')).toBe(null);
});

test('a next-page head node with nothing before it goes in at the top of the head', async () => {
	owned('<meta name="rn-kept" content="1">');
	pages['/rn-top'] = { head: '<meta name="rn-kept" content="1">', body: '<p>next</p>' };
	await go('/rn-top');
	expect(document.head.firstElementChild?.getAttribute('name')).toBe('ogygia-router');
});

test('a next-page sheet that fails to load does not hold the swap to the cap', async () => {
	pages['/rn-sheet-404'] = {
		head: '<link rel="stylesheet" href="/rn-no-such-sheet.css">',
		body: '<p id="next">next</p>'
	};
	const t0 = performance.now();
	await go('/rn-sheet-404');
	expect(performance.now() - t0).toBeLessThan(1_500);
});

it_with_network_routes('a disabled next-page sheet is not waited for', async () => {
	const held = '/rn-sheet-disabled.css';
	await commands.hold_downloads(held);
	pages['/rn-sheet-disabled'] = {
		head: `<link rel="stylesheet" href="${held}" disabled media="(max-width: 0)">`,
		body: '<p>next</p>'
	};
	try {
		const t0 = performance.now();
		await go('/rn-sheet-disabled');
		expect(performance.now() - t0).toBeLessThan(1_500);
	} finally {
		await commands.keep_downloads(held);
	}
});

it_with_network_routes(
	'a next-page sheet waited for loads at high priority, in its fresh-load place',
	async () => {
		const held = '/rn-sheet-place.css';
		await commands.hold_downloads(held);
		owned('<meta name="rn-anchor" content="1">');
		owned('<meta name="rn-tail" content="1">');
		pages['/rn-sheet-place'] = {
			head: `<meta name="rn-anchor" content="1"><link rel="stylesheet" href="${held}"><meta name="rn-tail" content="1">`,
			body: '<p>next</p>'
		};
		try {
			void r.navigate(new URL('/rn-sheet-place', location.href));
			const link = await in_head(`link[href="${held}"]`);
			expect(link.getAttribute('fetchpriority')).toBe('high');
			expect(link.previousElementSibling?.getAttribute('name')).toBe('rn-anchor');
		} finally {
			await commands.keep_downloads(held);
		}
		await expect.poll(() => r.nav.now.kind, { timeout: 5_000 }).toBe('idle');
	}
);

test('only the next page’s load-timed holes join the navigation’s batch', async () => {
	const asked: string[][] = [];
	const frames = slots.frames;
	slots.frames = {
		...frames,
		stream: (endpoints: string[]) => {
			asked.push(endpoints);
			return Promise.resolve();
		}
	} as never;
	const ep = (id: string) => `/__ogygia__?id=${id}&props=W3t9XQ&exp=9999999999&sig=stub`;
	pages['/rn-batch'] = {
		body: `<ogygia-region render="defer" endpoint="${ep('load')}"></ogygia-region><ogygia-region render="defer" when="visible" endpoint="${ep('visible')}"></ogygia-region>`
	};
	try {
		await go('/rn-batch');
	} finally {
		slots.frames = frames;
	}
	expect(asked).toEqual([[ep('load')]]);
});

test('a soft refresh that landed at another address reads the head as that page wrote it', async () => {
	pages['/rn-soft-r/a/b'] = { body: '<p>b</p>' };
	await go('/rn-soft-r/a/b');
	pages['/rn-soft-r/a/b'] = {
		head: '<link rel="preload" as="image" href="x.png">',
		body: '<p>b</p>',
		landed: '/rn-soft-r/z'
	};
	await r.invalidateAll();
	expect(document.head.querySelector('link[rel="preload"]')?.getAttribute('href')).toBe(
		'/rn-soft-r/x.png'
	);
});

test('a soft refresh lets go of the region head nodes the refreshed page no longer lists', async () => {
	pages['/rn-soft-release'] = { body: '<p>a</p>' };
	await go('/rn-soft-release');
	const sheet = owned('<style data-ogygia-region-css="/_app/gone.css">.gone{}</style>');
	await r.invalidateAll();
	expect(sheet.isConnected).toBe(false);
});

test('a soft refresh a newer one took over ends quietly and merges nothing', async () => {
	const first = gate();
	pages['/rn-soft-two'] = { head: '<meta name="rn-v" content="0">', body: '<p>a</p>' };
	await go('/rn-soft-two');
	pages['/rn-soft-two'] = {
		head: '<meta name="rn-v" content="1">',
		body: '<p>a</p>',
		gate: first.wait
	};
	const older = r.invalidateAll();
	await expect.poll(() => fetched.filter((p) => p === '/rn-soft-two').length).toBe(2);
	pages['/rn-soft-two'] = { head: '<meta name="rn-v" content="2">', body: '<p>a</p>' };
	await r.invalidateAll();
	first.open();
	await expect(older).resolves.toBeUndefined();
	expect(document.head.querySelector('meta[name="rn-v"]')?.getAttribute('content')).toBe('2');
});

/** Is the scroll hold on? (The browser's anchoring is off while it is.) */
const holding = () => document.documentElement.style.overflowAnchor === 'none';

test('the hold gives the page its scroll anchoring back when it ends', async () => {
	document.body.innerHTML = TALL;
	document.documentElement.style.overflowAnchor = 'auto';
	const visit = scope();
	hold_scroll({ x: 0, y: 900 }, visit);
	expect(holding()).toBe(true);
	visit.close();
	expect(document.documentElement.style.overflowAnchor).toBe('auto');
});

test('a visit already over holds nothing', () => {
	document.body.innerHTML = TALL;
	const visit = scope();
	visit.close();
	hold_scroll({ x: 0, y: 900 }, visit);
	expect(scrollY).toBeCloseTo(900, 0);
	expect(holding()).toBe(false);
});

test('the visitor’s wheel ends the hold', async () => {
	document.body.innerHTML = `<ogygia-region entry="/never.js" wake="load"></ogygia-region>${TALL}`;
	const visit = scope();
	hold_scroll({ x: 0, y: 900 }, visit);
	expect(holding()).toBe(true);
	window.dispatchEvent(new WheelEvent('wheel'));
	expect(holding()).toBe(false);
	visit.close();
});

test('the app’s own scroll ends the hold', async () => {
	document.body.innerHTML = `<ogygia-region entry="/never.js" wake="load"></ogygia-region>${TALL}`;
	const visit = scope();
	hold_scroll({ x: 0, y: 900 }, visit);
	scrollTo(0, 100);
	await frame();
	expect(holding()).toBe(false);
	visit.close();
});

test('a page too short for the saved place is held at its bottom, and taken there once it grows', async () => {
	document.body.innerHTML = `<ogygia-region entry="/never.js" wake="load"></ogygia-region><div id="grow" style="height: 1500px"></div>`;
	const visit = scope();
	hold_scroll({ x: 0, y: 3000 }, visit);
	await frame();
	await frame();
	expect(holding()).toBe(true);
	(document.getElementById('grow') as HTMLElement).style.height = '6000px';
	await frame();
	await frame();
	expect(scrollY).toBeCloseTo(3000, 0);
	visit.close();
});

test.each([
	[
		'a load region above',
		'<ogygia-region entry="/never.js" wake="load" style="display:block;height:10px"></ogygia-region>',
		true
	],
	[
		'an idle region above',
		'<ogygia-region entry="/never.js" wake="idle" style="display:block;height:10px"></ogygia-region>',
		true
	],
	[
		'an interaction region above',
		'<ogygia-region entry="/never.js" wake="interaction" style="display:block;height:10px"></ogygia-region>',
		false
	],
	[
		'a visible region that ends above the place',
		'<ogygia-region entry="/never.js" wake="visible" style="display:block;height:10px"></ogygia-region>',
		false
	],
	[
		'a load region below the place',
		'<div style="height: 2000px"></div><ogygia-region entry="/never.js" wake="load" style="display:block;height:10px"></ogygia-region>',
		false
	]
])('%s: the hold waits for it: %s', async (_, html, waits) => {
	document.body.innerHTML = `${html}${TALL}`;
	const visit = scope();
	hold_scroll({ x: 0, y: 1200 }, visit);
	await frame();
	await frame();
	await frame();
	expect(holding()).toBe(waits);
	visit.close();
});

test('a region inside another region above wakes with it: the hold ends when the outer one has', async () => {
	document.body.innerHTML = `<ogygia-region id="outer" entry="/never.js" wake="load" style="display:block;height:20px"><ogygia-region entry="/never-inner.js" wake="load"></ogygia-region></ogygia-region>${TALL}`;
	const visit = scope();
	hold_scroll({ x: 0, y: 1200 }, visit);
	const outer = document.getElementById('outer')!;
	outer.setAttribute('data-hydrated', '');
	outer.dispatchEvent(new CustomEvent('ogygia:hydrated', { bubbles: true }));
	await frame();
	await frame();
	await frame();
	expect(holding()).toBe(false);
	visit.close();
});
