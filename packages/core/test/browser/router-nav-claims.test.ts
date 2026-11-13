// A CLIENT NAVIGATION, END TO END IN ONE PAGE (runtime/router-nav.ts `navigate`): the head it
// keeps and adds, the focus and announcer it leaves, the view transition, the sheets it waits for,
// and every page it hands to the browser instead.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { history_room } from './_history-budget.ts';
import { in_head } from './_in-head.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
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
	/** the router marker's content; `null`: no marker (not an ogygia page) */
	marker?: string | null;
	status?: number;
	body_attrs?: string;
	/** the answer waits for this */
	gate?: Promise<unknown>;
	/** the fetch was redirected, and landed here */
	landed?: string;
};
/** The pages the server has, by path. */
let pages: Record<string, Page> = {};
const fetched: string[] = [];
const asked: Headers[] = [];

function serve() {
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input), location.href);
		fetched.push(url.pathname);
		asked.push(new Headers(init?.headers));
		const page = pages[url.pathname];
		if (!page) return new Response('', { status: 404 });
		await page.gate;
		const marker =
			page.marker === null ? '' : `<meta name="ogygia-router" content="${page.marker ?? 'plain'}">`;
		const res = new Response(
			`<!doctype html><html><head>${marker}${page.head ?? ''}</head><body ${page.body_attrs ?? ''}>${page.body}</body></html>`,
			{ status: page.status ?? 200, headers: { 'content-type': 'text/html' } }
		);
		if (page.landed) {
			const landed = new URL(page.landed, location.href).href;
			Object.defineProperty(res, 'redirected', { value: true });
			Object.defineProperty(res, 'url', { value: landed });
		}
		return res;
	};
}

let r: SpaRouter;
let handed: string[];
/** the history move each hand-off asked for */
let handed_moves: string[];

beforeEach(async () => {
	await history_room();
	link_boot();
	install_morph();
	pages = {};
	fetched.length = 0;
	asked.length = 0;
	handed = [];
	handed_moves = [];
	document.body.innerHTML = '<p>first</p>';
	runtime_session.adopt_document_head();
	prepare_spa_document();
	window.reportError = () => {};
	serve();
	r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation((url, _visit, move) => {
		handed.push(url.pathname);
		handed_moves.push(move);
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
});

async function go(path: string, opts: Parameters<SpaRouter['navigate']>[1] = {}) {
	await r.navigate(new URL(path, location.href), opts);
	await expect.poll(() => r.nav.now.kind, { timeout: 5_000 }).toBe('idle');
	expect(handed).toEqual([]);
}

/** The first document, as the server sent it at `path`: its own head node `html`, as written. */
function first_document(path: string, html: string): Element {
	history.replaceState(null, '', path);
	const t = document.createElement('template');
	t.innerHTML = html;
	const el = t.content.firstElementChild!;
	document.head.append(el);
	runtime_session.claim_page_head(el);
	r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.pathname);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	return el;
}

test('a first-document head node kept across pages at two depths stays one node while the address moves again', async () => {
	const node = first_document('/rn-a/b/c', '<link rel="preload" as="image" href="../i.png">');
	pages['/rn-a/z'] = { head: '<link rel="preload" as="image" href="i.png">', body: '<p>z</p>' };
	pages['/rn-a/b/w'] = {
		head: '<link rel="preload" as="image" href="../i.png">',
		body: '<p>w</p>'
	};
	await go('/rn-a/z');
	await go('/rn-a/b/w');
	expect(document.head.querySelectorAll('link[rel="preload"]')).toHaveLength(1);
	expect(document.head.querySelector('link[rel="preload"]')).toBe(node);
	expect(node.getAttribute('href')).toBe('../i.png');
});

test('a parked sheet the page does not own keeps its URL as written', async () => {
	const theirs = document.createElement('link');
	theirs.rel = 'stylesheet';
	theirs.disabled = true;
	theirs.setAttribute('href', 'theirs.css');
	document.head.append(theirs);
	pages['/rn-parked/x/y'] = { body: '<p>y</p>' };
	await go('/rn-parked/x/y');
	expect(theirs.getAttribute('href')).toBe('theirs.css');
});

test('a parked link of the page that is no stylesheet keeps its URL as written', async () => {
	const live = first_document(
		'/rn-parked-rel/a',
		'<link rel="preload" as="image" href="p.png" disabled>'
	);
	pages['/rn-parked-rel/a/b/c'] = {
		head: '<link rel="preload" as="image" href="../../p.png" disabled>',
		body: '<p>c</p>'
	};
	await go('/rn-parked-rel/a/b/c');
	expect(live.isConnected).toBe(true);
	expect(live.getAttribute('href')).toBe('p.png');
});

test('the FOUC bag is a fresh node on every page, even with the same CSS', async () => {
	pages['/rn-bag-a'] = { head: '<style data-sveltekit>p{color:red}</style>', body: '<p>a</p>' };
	pages['/rn-bag-b'] = { head: '<style data-sveltekit>p{color:red}</style>', body: '<p>b</p>' };
	await go('/rn-bag-a');
	const first = document.head.querySelector('style[data-sveltekit]');
	await go('/rn-bag-b');
	const bags = document.head.querySelectorAll('style[data-sveltekit]');
	expect(bags).toHaveLength(1);
	expect(bags[0]).not.toBe(first);
});

test('an inlined region sheet for one href stays one node across pages, kept', async () => {
	pages['/rn-css-a'] = {
		head: '<style data-ogygia-region-css="/_app/r.css">.r{color:red}</style>',
		body: '<p>a</p>'
	};
	pages['/rn-css-b'] = {
		head: '<style data-ogygia-region-css="/_app/r.css">.r{color: red}</style>',
		body: '<p>b</p>'
	};
	await go('/rn-css-a');
	const first = document.head.querySelector('style[data-ogygia-region-css]');
	await go('/rn-css-b');
	expect(document.head.querySelectorAll('style[data-ogygia-region-css]')).toHaveLength(1);
	expect(document.head.querySelector('style[data-ogygia-region-css]')).toBe(first);
});

test('a dev server style injected on the client survives a page that does not list it', async () => {
	const injected = document.createElement('style');
	injected.setAttribute('data-vite-dev-id', '/src/x.svelte?css');
	injected.textContent = '.x{color:red}';
	document.head.append(injected);
	runtime_session.claim_page_head(injected);
	pages['/rn-dev-style'] = { body: '<p>next</p>' };
	await go('/rn-dev-style');
	expect(injected.isConnected).toBe(true);
});

test('a navigation focuses the page body, and leaves it no tabindex', async () => {
	pages['/rn-focus-body'] = { body: '<p>next</p>' };
	await go('/rn-focus-body');
	expect(document.activeElement).toBe(document.body);
	expect(document.body.hasAttribute('tabindex')).toBe(false);
});

test('a #hash target is focused without a lasting tabindex: it goes when focus leaves', async () => {
	pages['/rn-focus-hash'] = { body: '<h2 id="part">Part</h2><button>b</button>' };
	await go('/rn-focus-hash#part');
	const heading = document.getElementById('part')!;
	expect(document.activeElement).toBe(heading);
	expect(heading.getAttribute('tabindex')).toBe('-1');
	heading.blur();
	expect(heading.hasAttribute('tabindex')).toBe(false);
});

test('a #hash target focused twice in a row still gives its tabindex back once', async () => {
	pages['/rn-focus-twice'] = { body: '<h2 id="part" tabindex="3">Part</h2>' };
	await go('/rn-focus-twice#part');
	await go('/rn-focus-twice#part', { replace: true });
	const heading = document.getElementById('part')!;
	expect(document.activeElement).toBe(heading);
	heading.blur();
	expect(heading.getAttribute('tabindex')).toBe('3');
});

test('a heading still on loan when the next navigation focuses it keeps its own tabindex, not the loan’s', async () => {
	pages['/rn-lent-1'] = { body: '<h2 id="part">Part</h2>' };
	// the next page's copy carries the loan's value: the morph leaves the focused heading as it is
	pages['/rn-lent-2'] = { body: '<h2 id="part" tabindex="-1">Part</h2>' };
	await go('/rn-lent-1#part');
	const heading = document.getElementById('part')!;
	await go('/rn-lent-2#part');
	expect(document.getElementById('part')).toBe(heading);
	expect(document.activeElement).toBe(heading);
	heading.blur();
	expect(heading.hasAttribute('tabindex')).toBe(false);
});

test('an [autofocus] element on the next page takes focus', async () => {
	pages['/rn-autofocus'] = { body: '<input id="q" autofocus>' };
	await go('/rn-autofocus');
	expect(document.activeElement?.id).toBe('q');
});

test('focus inside chrome kept across the navigation stays where it is', async () => {
	document.body.innerHTML =
		'<nav data-ogygia-keep="nav"><button id="menu">menu</button></nav><p>first</p>';
	pages['/rn-focus-kept'] = {
		body: '<nav data-ogygia-keep="nav"><button id="menu">menu</button></nav><p>next</p>'
	};
	document.getElementById('menu')!.focus();
	await go('/rn-focus-kept');
	expect(document.activeElement?.id).toBe('menu');
});

test('a back step gives focus back to the element that had it when its entry was left', async () => {
	pages['/rn-focus-back'] = { body: '<button id="b1">1</button><button id="b2">2</button>' };
	await go('/rn-focus-back', {
		push: false,
		type: 'popstate',
		pop: {
			id: 'rn-focus-back',
			url: new URL('/rn-focus-back', location.href),
			scroll: null,
			focus: 'b2'
		}
	});
	expect(document.activeElement?.id).toBe('b2');
});

test('the announcer says the new page, readable by assistive tech', async () => {
	pages['/rn-announce'] = { head: '<title>Next page</title>', body: '<p>next</p>' };
	await go('/rn-announce');
	const el = document.querySelector('[data-ogygia-announcer]') as HTMLElement;
	expect(el.textContent).toBe('Next page');
	expect(el.getAttribute('aria-live')).toBe('assertive');
	expect(getComputedStyle(el).display).not.toBe('none');
	expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(1);
});

test('the announcer stays one node with its own text when the next page ends in an element like it', async () => {
	pages['/rn-announce-1'] = { head: '<title>One</title>', body: '<p>one</p>' };
	pages['/rn-announce-2'] = {
		head: '<title>Two</title>',
		body: '<p>two</p><div aria-live="polite" class="toast">saved</div>'
	};
	await go('/rn-announce-1');
	const el = document.querySelector('[data-ogygia-announcer]');
	await go('/rn-announce-2');
	expect(document.querySelectorAll('[data-ogygia-announcer]')).toHaveLength(1);
	expect(document.querySelector('[data-ogygia-announcer]')).toBe(el);
	expect(el?.textContent).toBe('Two');
	expect(document.querySelector('.toast')?.textContent).toBe('saved');
});

/** A view transition that runs its callback at once, and records the names it captured. */
function fake_transition(seen: Map<string, string>[]) {
	let finish = () => {};
	const finished = new Promise<void>((resolve) => (finish = resolve));
	document.startViewTransition = ((cb: () => void) => {
		const names = new Map<string, string>();
		for (const el of document.querySelectorAll<HTMLElement>('[id]'))
			names.set(el.id, el.style.getPropertyValue('view-transition-name'));
		seen.push(names);
		cb();
		return {
			ready: Promise.resolve(),
			finished,
			updateCallbackDone: Promise.resolve(),
			skipTransition() {}
		};
	}) as never;
	return () => finish();
}

test('names with no counterpart on the next page fold into the page cross-fade, and come back after', async () => {
	document.body.innerHTML =
		'<a id="both" style="view-transition-name: chip">chip</a><a id="here" style="view-transition-name: row-1">row</a>';
	pages['/rn-vt'] = {
		marker: '',
		body: '<a id="both" style="view-transition-name: chip">chip</a><h1 id="there" style="view-transition-name: hero">hero</h1>'
	};
	const seen: Map<string, string>[] = [];
	const finish = fake_transition(seen);
	const here = document.getElementById('here')!;
	await go('/rn-vt');
	expect(seen).toHaveLength(1);
	expect(seen[0].get('both')).toBe('chip');
	expect(seen[0].get('here')).toBe('none');
	expect(document.getElementById('there')!.style.getPropertyValue('view-transition-name')).toBe(
		'none'
	);
	finish();
	await expect.poll(() => here.style.getPropertyValue('view-transition-name')).toBe('row-1');
});

test('folded names come back when the transition is skipped', async () => {
	document.body.innerHTML = '<a id="here" style="view-transition-name: row-1">row</a>';
	pages['/rn-vt-skip'] = { marker: '', body: '<p>next</p>' };
	const here = document.getElementById('here')!;
	document.startViewTransition = ((cb: () => void) => {
		cb();
		const skipped = Promise.reject(new DOMException('Transition was skipped', 'AbortError'));
		return {
			ready: skipped,
			finished: Promise.reject(new DOMException('Transition was skipped', 'AbortError')),
			updateCallbackDone: Promise.resolve(),
			skipTransition() {}
		};
	}) as never;
	await go('/rn-vt-skip');
	await expect.poll(() => here.style.getPropertyValue('view-transition-name')).toBe('row-1');
});

test('a visitor who asks for reduced motion gets no view transition', async () => {
	const real_match = window.matchMedia;
	window.matchMedia = ((q: string) =>
		({ matches: q.includes('prefers-reduced-motion'), media: q }) as MediaQueryList) as never;
	const seen: Map<string, string>[] = [];
	fake_transition(seen);
	pages['/rn-reduced'] = { marker: '', body: '<p id="next">next</p>' };
	try {
		await go('/rn-reduced');
	} finally {
		window.matchMedia = real_match;
	}
	expect(seen).toHaveLength(0);
	expect(document.getElementById('next')).not.toBe(null);
});

it_with_network_routes('the swap waits for a next-page sheet still loading', async () => {
	const held = '/rn-sheet-wait.css';
	await commands.hold_downloads(held);
	pages['/rn-sheet-wait'] = {
		head: `<link rel="stylesheet" href="${held}">`,
		body: '<p id="next">next</p>'
	};
	try {
		void r.navigate(new URL('/rn-sheet-wait', location.href));
		await in_head(`link[href="${held}"]`);
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(r.nav.now.kind).toBe('loading');
		expect(document.getElementById('next')).toBe(null);
	} finally {
		await commands.keep_downloads(held);
	}
	await expect.poll(() => r.nav.now.kind, { timeout: 5_000 }).toBe('idle');
	expect(document.getElementById('next')).not.toBe(null);
});

it_with_network_routes(
	'a sheet that never arrives holds the swap for two seconds at most',
	async () => {
		const held = '/rn-sheet-hung.css';
		await commands.hold_downloads(held);
		pages['/rn-sheet-hung'] = {
			head: `<link rel="stylesheet" href="${held}">`,
			body: '<p id="next">next</p>'
		};
		try {
			const t0 = performance.now();
			void r.navigate(new URL('/rn-sheet-hung', location.href));
			await expect.poll(() => document.getElementById('next'), { timeout: 8_000 }).not.toBe(null);
			expect(performance.now() - t0).toBeLessThan(6_000);
		} finally {
			await commands.keep_downloads(held);
		}
	}
);

/** The page on screen's runtime script: its build, by file name. (Inert: `text/plain`.) */
function runtime_script(src: string, locations: string) {
	const s = document.createElement('script');
	s.type = 'text/plain';
	s.setAttribute('data-ogygia-runtime', '');
	s.setAttribute('src', src);
	s.setAttribute('data-og-locations', locations);
	document.head.append(s);
}
const runtime_tag = (src: string, locations: string) =>
	`<script type="text/plain" data-ogygia-runtime src="${src}" data-og-locations="${locations}"></script>`;

test('a page of the same build, its runtime named from another depth, goes in', async () => {
	runtime_script(`${location.origin}/_app/og-runtime-a1.js`, `${location.origin}/_app/loc-b2.json`);
	pages['/rn-build/same'] = {
		head: runtime_tag('../_app/og-runtime-a1.js', '../_app/loc-b2.json'),
		body: '<p id="next">next</p>'
	};
	await go('/rn-build/same');
	expect(document.getElementById('next')).not.toBe(null);
});

test('a page whose location map is another build’s is a full load', async () => {
	runtime_script('/_app/og-runtime-a1.js', '/_app/loc-b2.json');
	pages['/rn-build-other'] = {
		head: runtime_tag('/_app/og-runtime-a1.js', '/_app/loc-c3.json'),
		body: '<p id="next">next</p>'
	};
	await r.navigate(new URL('/rn-build-other', location.href));
	await expect.poll(() => handed).toEqual(['/rn-build-other']);
});

test('an error page the server renders as HTML goes in without a full load', async () => {
	pages['/rn-error-page'] = { status: 404, body: '<h1 id="not-found">Not found</h1>' };
	await go('/rn-error-page');
	expect(document.getElementById('not-found')).not.toBe(null);
});

test('a modulepreload for a module the page already warmed is not put in the head again', async () => {
	const boot = slots.boot!;
	const real = boot.is_warmed_module;
	boot.is_warmed_module = (entry) => entry.endsWith('/warm.js');
	pages['/rn-modulepreload'] = {
		head: '<link rel="modulepreload" href="/_app/warm.js"><link rel="modulepreload" href="/_app/cold.js">',
		body: '<p>next</p>'
	};
	try {
		await go('/rn-modulepreload');
	} finally {
		boot.is_warmed_module = real;
	}
	const hrefs = [...document.head.querySelectorAll('link[rel="modulepreload"]')].map((l) =>
		l.getAttribute('href')
	);
	expect(hrefs).toEqual(['/_app/cold.js']);
});

/** A promise the test opens when it says. */
function gate(): { wait: Promise<void>; open: () => void } {
	let open = () => {};
	const wait = new Promise<void>((resolve) => (open = resolve));
	return { wait, open };
}

test('a next-page sheet loaded at high priority for the wait goes live at the priority it came with', async () => {
	const css = (n: string) => `data:text/css,.rn-prio-${n}%7Bcolor:red%7D`;
	pages['/rn-sheet-prio'] = {
		head: `<link rel="stylesheet" href="${css('a')}"><link rel="stylesheet" href="${css('b')}" fetchpriority="low">`,
		body: '<p>next</p>'
	};
	await go('/rn-sheet-prio');
	const a = document.head.querySelector(`link[href="${css('a')}"]`)!;
	const b = document.head.querySelector(`link[href="${css('b')}"]`)!;
	expect(a.hasAttribute('fetchpriority')).toBe(false);
	expect(b.getAttribute('fetchpriority')).toBe('low');
});

test('a navigation whose claim a newer one took fetches nothing', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	pages['/rn-claimed'] = { body: '<p>next</p>' };
	r.nav.go('claimed', { href: 'about:first' });
	const first = r.nav.now;
	r.nav.go('claimed', { href: 'about:second' });
	await nav.navigate(r, new URL('/rn-claimed', location.href), r.current_url, {}, first);
	expect(fetched).toEqual([]);
	r.nav.go('idle');
});

test('a back step reads the live head as written for the page on screen, not the address the browser moved to', async () => {
	const node = first_document('/rn-back/a/b', '<link rel="preload" as="image" href="../x.png">');
	r.history.start();
	pages['/rn-back/a/c'] = {
		head: '<link rel="preload" as="image" href="../x.png">',
		body: '<p>c</p>'
	};
	// the browser moved to another entry on the back step before the router heard of it
	history.replaceState({ ogygia: 'rn-back' }, '', '/elsewhere/deep/er');
	const url = new URL('/rn-back/a/c', location.href);
	await go('/rn-back/a/c', {
		push: false,
		type: 'popstate',
		pop: { id: 'rn-back', url, scroll: null, focus: null }
	});
	expect(document.head.querySelector('link[rel="preload"]')).toBe(node);
});

test('a head node the page on screen added while the next one loaded is read as written for it', async () => {
	const answer = gate();
	pages['/rn-left/a/b'] = { body: '<p>b</p>' };
	pages['/rn-left/c'] = {
		head: '<link rel="preload" as="image" href="x.png">',
		body: '<p>c</p>',
		gate: answer.wait
	};
	await go('/rn-left/a/b');
	const went = r.navigate(new URL('/rn-left/c', location.href));
	await expect.poll(() => fetched.includes('/rn-left/c')).toBe(true);
	const added = document.createElement('link');
	added.rel = 'preload';
	added.as = 'image';
	added.setAttribute('href', '../x.png');
	document.head.append(added);
	runtime_session.claim_page_head(added);
	answer.open();
	await went;
	await expect.poll(() => r.nav.now.kind).toBe('idle');
	expect(document.head.querySelectorAll('link[rel="preload"]')).toHaveLength(1);
	expect(document.head.querySelector('link[rel="preload"]')).toBe(added);
});

it_with_network_routes(
	'a navigation called off before its swap ends what it started for the next page',
	async () => {
		const answer = gate();
		const visits: { closed: boolean }[] = [];
		const frames = slots.frames;
		slots.frames = {
			...frames,
			stream: (_endpoints: string[], visit: { closed: boolean }) => {
				visits.push(visit);
				return Promise.resolve();
			}
		} as never;
		const held = '/rn-called-off.css';
		await commands.hold_downloads(held);
		pages['/rn-called-off'] = {
			head: `<link rel="stylesheet" href="${held}">`,
			body: '<ogygia-region render="defer" endpoint="/__ogygia__?id=a&props=W3t9XQ&exp=9999999999&sig=stub"></ogygia-region>'
		};
		pages['/rn-newer'] = { body: '<p>newer</p>', gate: answer.wait };
		try {
			void r.navigate(new URL('/rn-called-off', location.href));
			await in_head(`link[href="${held}"]`);
			expect(visits).toHaveLength(1);
			expect(visits[0].closed).toBe(false);
			const newer = r.navigate(new URL('/rn-newer', location.href));
			await expect.poll(() => fetched.includes('/rn-newer')).toBe(true);
			expect(visits[0].closed).toBe(true);
			answer.open();
			await newer;
			await expect.poll(() => r.nav.now.kind).toBe('idle');
		} finally {
			slots.frames = frames;
			await commands.keep_downloads(held);
		}
	}
);

test('a back or forward step asks for the page as a history restore', async () => {
	pages['/rn-history'] = { body: '<p>back</p>' };
	await go('/rn-history', {
		push: false,
		type: 'popstate',
		pop: { id: 'rn-history', url: new URL('/rn-history', location.href), scroll: null, focus: null }
	});
	expect(asked[0].get('x-ogygia-purpose')).toBe('history');
});

test('a fetch the server redirected puts the address it landed on in the address bar', async () => {
	pages['/rn-redirect'] = { body: '<p id="landed">landed</p>', landed: '/rn-redirect-landed' };
	await go('/rn-redirect');
	expect(location.pathname).toBe('/rn-redirect-landed');
	expect(document.getElementById('landed')).not.toBe(null);
});

test('a fetch redirected to another origin is a full load of the address clicked', async () => {
	pages['/rn-foreign'] = { body: '<p>foreign</p>', landed: 'https://other.example.com/x' };
	await r.navigate(new URL('/rn-foreign', location.href));
	await expect.poll(() => handed).toEqual(['/rn-foreign']);
});

test('a redirect to a page that is no ogygia page is a full load of the address clicked, not the landing', async () => {
	pages['/rn-clicked'] = { body: '<p>plain</p>', marker: null, landed: '/rn-plain-landing' };
	await r.navigate(new URL('/rn-clicked', location.href));
	await expect.poll(() => handed).toEqual(['/rn-clicked']);
});

test.each([
	['a csr=true page', '<meta name="ogygia-csr" content="true">'],
	['a page in its first-load form', '<meta name="ogygia-first-load">']
])('%s is a full load', async (_, head) => {
	pages['/rn-full'] = { head, body: '<p>next</p>' };
	await r.navigate(new URL('/rn-full', location.href));
	await expect.poll(() => handed).toEqual(['/rn-full']);
});

test('the app’s restorer reshapes the next page before it goes in', async () => {
	const g = globalThis as { __og_restore?: (doc: Document) => void };
	g.__og_restore = (doc) =>
		doc.body.querySelector('[data-shaped]')?.setAttribute('data-shaped', 'restored');
	pages['/rn-restore'] = { body: '<p data-shaped="moved">next</p>' };
	try {
		await go('/rn-restore');
	} finally {
		delete g.__og_restore;
	}
	expect(document.querySelector('[data-shaped]')?.getAttribute('data-shaped')).toBe('restored');
});

test('a region of the next page names its files against that page’s address', async () => {
	pages['/rn-pin/a/b'] = {
		body: '<ogygia-region wake="none" entry="../r.js" src="../r-1.js"></ogygia-region>'
	};
	await go('/rn-pin/a/b');
	const region = document.querySelector('ogygia-region')!;
	expect(region.getAttribute('src')).toBe('/rn-pin/r-1.js');
});

test('the transition starts after the build yields its task', async () => {
	const order: string[] = [];
	const boot = slots.boot!;
	const real_yield = boot.yield_task;
	boot.yield_task = () => {
		order.push('yield');
		return real_yield();
	};
	document.startViewTransition = ((update: () => void) => {
		order.push('transition');
		update();
		return {
			ready: Promise.resolve(),
			finished: Promise.resolve(),
			updateCallbackDone: Promise.resolve(),
			skipTransition() {}
		};
	}) as never;
	pages['/rn-yield'] = { marker: '', body: '<p>next</p>' };
	try {
		await go('/rn-yield');
	} finally {
		boot.yield_task = real_yield;
	}
	expect(order).toEqual(['yield', 'transition']);
});

test('a soft refresh of the page being left never lands on the next page', async () => {
	const answer = gate();
	pages['/rn-soft-a'] = { head: '<meta name="rn-soft" content="a">', body: '<p>a</p>' };
	await go('/rn-soft-a');
	pages['/rn-soft-a'] = {
		head: '<meta name="rn-soft" content="a-refreshed">',
		body: '<p>a</p>',
		gate: answer.wait
	};
	pages['/rn-soft-b'] = { head: '<meta name="rn-soft" content="b">', body: '<p>b</p>' };
	const soft = r.invalidateAll();
	await expect.poll(() => fetched.filter((p) => p === '/rn-soft-a').length).toBe(2);
	await go('/rn-soft-b');
	answer.open();
	await soft;
	expect(document.head.querySelector('meta[name="rn-soft"]')?.getAttribute('content')).toBe('b');
	expect(slots.boot!.soft.now.kind).toBe('idle');
});

test('a commit that fails after it wrote the history entry hands that entry to the browser', async () => {
	const g = globalThis as { __og_restore_adopt?: () => void };
	g.__og_restore_adopt = () => {
		throw new Error('adopt broke');
	};
	pages['/rn-commit-fails'] = { body: '<p>next</p>' };
	try {
		await r.navigate(new URL('/rn-commit-fails', location.href));
		await expect.poll(() => handed).toEqual(['/rn-commit-fails']);
	} finally {
		delete g.__og_restore_adopt;
	}
	expect(handed_moves).toEqual(['replace']);
});

test.each([
	['the next page', '', 'data-og-no-reconcile'],
	['the page on screen', 'data-og-no-reconcile', '']
])('an author who opts %s out of the reconcile gets a whole-body swap', async (_, live, next) => {
	if (live) document.body.setAttribute(live, '');
	let reconciled: boolean | undefined;
	slots.hooks = { navigated: (e) => void (reconciled = e.reconciled) };
	pages['/rn-optout'] = { body: '<p>next</p>', body_attrs: next };
	try {
		await go('/rn-optout');
	} finally {
		slots.hooks = undefined;
		document.body.removeAttribute('data-og-no-reconcile');
	}
	expect(reconciled).toBe(false);
});

test('a navigation fires before-swap, after-swap and page-load once each, in order', async () => {
	const heard: string[] = [];
	const listen = (name: string) => {
		const on = () => heard.push(`${name}:${document.getElementById('next') ? 'next' : 'first'}`);
		document.addEventListener(name, on);
		return () => document.removeEventListener(name, on);
	};
	const offs = ['og:before-swap', 'og:after-swap', 'og:page-load'].map(listen);
	pages['/rn-events'] = { body: '<p id="next">next</p>' };
	try {
		await go('/rn-events');
	} finally {
		for (const off of offs) off();
	}
	expect(heard).toEqual(['og:before-swap:first', 'og:after-swap:next', 'og:page-load:next']);
});

test('form continuity: the page left is read before the swap, the next page is given back its fields after', async () => {
	const calls: string[] = [];
	const forms = slots.forms;
	slots.forms = {
		enabled: true,
		snapshot: (root, key) =>
			void calls.push(
				`snapshot ${key} ${(root as Element).querySelector('#next') ? 'next' : 'first'}`
			),
		restore: (key) =>
			void calls.push(`restore ${key} ${document.getElementById('next') ? 'next' : 'first'}`)
	};
	history.replaceState(null, '', '/rn-forms-left');
	r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation(() => {});
	pages['/rn-forms'] = { body: '<p id="next">next</p>' };
	try {
		await go('/rn-forms');
	} finally {
		slots.forms = forms;
	}
	expect(calls).toEqual(['snapshot /rn-forms-left first', 'restore /rn-forms next']);
});

test('a streamed page’s late chunks go into their slots after a client navigation', async () => {
	pages['/rn-late'] = {
		body: '<og-late-slot data-og-slot="s1"><p>loading</p></og-late-slot><template data-og-late="s1"><p id="late">late</p></template>'
	};
	await go('/rn-late');
	expect(document.querySelector('og-late-slot #late')).not.toBe(null);
	expect(document.querySelector('template[data-og-late]')).toBe(null);
});

test('a late chunk’s stylesheet goes into the head', async () => {
	pages['/rn-late-css'] = {
		body: '<og-late-slot data-og-slot="s2"></og-late-slot><template data-og-late="s2"><style data-rn-late>.x{}</style><p id="late">late</p></template>'
	};
	await go('/rn-late-css');
	expect(document.head.querySelector('style[data-rn-late]')).not.toBe(null);
});

test('after the swap, the kit remotes the page left are let go', async () => {
	let released = 0;
	const remote = slots.remoteSeeds;
	// (the remote seeds feature, doing nothing but counting its release)
	slots.remoteSeeds = new Proxy(
		{},
		{ get: (_, key) => (key === 'release_remote_instances' ? () => void released++ : () => {}) }
	) as never;
	pages['/rn-remotes'] = { body: '<p>next</p>' };
	try {
		await go('/rn-remotes');
	} finally {
		slots.remoteSeeds = remote;
	}
	expect(released).toBe(1);
});
