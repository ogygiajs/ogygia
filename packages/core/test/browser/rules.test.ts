// THE RUNTIME'S RULES (#313, runtime/rules.ts), in a real browser on the real runtime: a page that
// keeps them reports none, and each one, broken, is reported under its code, by `__ogygia_rules()`
// (what e2e reads at the end of every test) and, in dev, said a task after the move that broke it.
//
// Its own file: the rules are module state shared by a file's tests.
import { afterEach, expect, inject, test, vi } from 'vitest';
import { STALE } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';
import {
	note_handed,
	note_left,
	note_mount,
	note_shown,
	note_turn,
	note_unbound,
	note_unmount,
	watch_frames,
	watch_router
} from '../../src/runtime/rules.ts';
import type { RegionMachinesNow } from '../../src/runtime/region-machines.ts';
import { _reset, peek, ticket, write } from '../_frames.ts';
import { runtime_session } from '../../src/runtime/session.ts';

type Broken = Array<{ code: string; detail: string }>;
const rules = (): Broken =>
	(globalThis as unknown as { __ogygia_rules: () => Broken }).__ogygia_rules();
const codes = () => rules().map((b) => b.code);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const counter_html = () => decodeURIComponent(escape(atob(inject('counter_ssr_b64'))));

afterEach(() => vi.restoreAllMocks());

test('a page that keeps them: an island mounts, leaves the page, and no rule is broken', async () => {
	document.body.innerHTML = counter_html();
	const region = document.querySelector('ogygia-region')!;
	bootDev();
	expect(typeof (globalThis as { __ogygia_rules?: unknown }).__ogygia_rules).toBe('function');
	await expect.poll(() => region.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
	expect(rules()).toEqual([]);
	region.remove();
	await tick(10); // past its teardown
	expect(rules()).toEqual([]);
});

test("with rules on, `__ogygia_moves()` gives the page's machine moves, one line each", () => {
	const moves = (globalThis as { __ogygia_moves?: () => string }).__ogygia_moves;
	expect(typeof moves).toBe('function');
	const lines = moves!().split('\n');
	expect(lines.some((l) => /^wake#\d+ \S+ -> \S+$/.test(l))).toBe(true);
});

test('one mount per region: a region holding two islands, or keeping one after it left', async () => {
	const el = document.createElement('ogygia-region');
	el.setAttribute('entry', 'probe.svelte');
	document.body.append(el);
	note_mount(el);
	expect(rules()).toEqual([]);
	note_mount(el);
	expect(rules()).toEqual([
		{ code: 'rule_region_mounted_twice', detail: 'probe.svelte holds 2 islands at once' }
	]);
	note_unmount(el);
	el.remove();
	expect(rules()).toEqual([
		{
			code: 'rule_region_mounted_twice',
			detail: 'probe.svelte left the page with its island still mounted'
		}
	]);
	note_unmount(el);
	expect(rules()).toEqual([]);
});

test("a region shows its address's answer: handed the newest, and painted it once no paint is out", () => {
	const behind = () => rules().filter((b) => b.code === 'rule_region_answer_behind');
	watch_frames(peek);
	const el = document.createElement('ogygia-region');
	el.setAttribute('entry', 'hole.svelte');
	document.body.append(el);
	let painting = false;
	const a = 'probe-hole|';
	// handed answer 1, its turn came, painted
	expect(write({ a, v: ticket(a), html: '<p>1</p>' })).toBe(true);
	note_handed(el, a, 1, () => painting);
	note_turn(el);
	note_shown(el, 1);
	expect(behind()).toEqual([]);
	// the store took answer 2, and the region never heard of it
	expect(write({ a, v: ticket(a), html: '<p>2</p>' })).toBe(true);
	expect(behind()).toEqual([
		{
			code: 'rule_region_answer_behind',
			detail: 'hole.svelte was last handed answer #1, its address holds #2'
		}
	]);
	// handed it: waiting for its turn, then painting, is no finding
	note_handed(el, a, 2, () => painting);
	expect(behind()).toEqual([]);
	note_turn(el);
	painting = true;
	expect(behind()).toEqual([]);
	// its paint ended without painting it
	painting = false;
	expect(behind()).toEqual([
		{
			code: 'rule_region_answer_behind',
			detail: 'hole.svelte shows answer #1, its address holds #2'
		}
	]);
	note_shown(el, 2);
	expect(behind()).toEqual([]);
	// off the page, or unbound: not its to show
	note_handed(el, a, 1, () => false);
	el.remove();
	expect(behind()).toEqual([]);
	document.body.append(el);
	note_unbound(el);
	expect(behind()).toEqual([]);
	el.remove();
	_reset();
});

test('a region that left the page is at rest: one of its machines still mid-visit is reported (#1132)', () => {
	const busy = () => rules().filter((b) => b.code === 'rule_region_left_busy');
	const el = document.createElement('ogygia-region');
	el.setAttribute('entry', 'left.svelte');
	const now: RegionMachinesNow = {
		hole: 'idle',
		wake: 'cold',
		'live-region': 'idle',
		'region-paint': 'painting'
	};
	note_left(el, () => now);
	expect(busy()).toEqual([
		{
			code: 'rule_region_left_busy',
			detail: 'left.svelte left the page with region-paint painting'
		}
	]);
	// back at rest: no finding, and the region is let go
	now['region-paint'] = 'idle';
	expect(busy()).toEqual([]);
	// put back on the page: its machines are the page's again
	now['region-paint'] = 'painting';
	note_left(el, () => now);
	document.body.append(el);
	expect(busy()).toEqual([]);
	el.remove();
});

test('nothing of an old page open: a visit before the one on screen still open', () => {
	// the page goes, the next one takes over: the old visit is closed with it
	runtime_session.reset(runtime_session.next_visit());
	expect(rules()).toEqual([]);
	// a navigation that ended without its swap and left its visit open, then another page went in
	const stray = runtime_session.next_visit();
	runtime_session.reset(runtime_session.next_visit());
	expect(rules()).toEqual([
		{ code: 'rule_old_page_open', detail: '1 page visit(s) before the one on screen still open' }
	]);
	stray.scope.close();
	// a visit made after the one on screen (a navigation's, still on its way) is not over
	const on_its_way = runtime_session.next_visit();
	expect(rules()).toEqual([]);
	on_its_way.scope.close();
});

test('the address bar and the history model: checked once no navigation is out', () => {
	const nav = { now: { kind: 'idle' } };
	const entry = { id: 'doc.1', url: new URL(location.href) };
	watch_router({ nav, history: { current: entry } });
	history.replaceState({ ogygia: 'doc.1' }, '');
	expect(rules()).toEqual([]);
	entry.url = new URL('/elsewhere', location.href);
	expect(codes()).toEqual(['rule_address_bar_drift']);
	nav.now = { kind: 'loading' }; // a navigation out: the bar moves at its commit
	expect(rules()).toEqual([]);
	nav.now = { kind: 'idle' };
	entry.url = new URL(`${location.href}#a-fragment`); // a fragment is the same page
	expect(rules()).toEqual([]);
	history.replaceState({ ogygia: 'doc.2' }, '');
	expect(rules()[0]?.detail).toBe('the address bar is on entry doc.2, the history model on doc.1');
	history.replaceState(null, ''); // an entry the router has not met: not its yet
	expect(rules()).toEqual([]);
});

test('every marker declared: the app’s own data-og-* attributes are the app’s, ogygia’s misspelled ones are broken', () => {
	const markup = () => rules().filter((b) => b.code === 'rule_markup_known');
	// an app's Open Graph tooling, on its own elements and on a web component ogygia restored
	document.body.innerHTML = `<div data-og-image="/a.png" data-og-title="A"></div><x-widget data-og-title="B" data-og-kept=""></x-widget>`;
	expect(markup()).toEqual([]);
	// ogygia's own namespace, or a marker on ogygia's own element, misspelled
	document.body.innerHTML =
		'<script data-ogygia-runtim></script><ogygia-region entry="a" data-og-hydratd></ogygia-region>';
	expect(markup()).toEqual([
		{
			code: 'rule_markup_known',
			detail: 'the page carries undeclared markers: data-ogygia-runtim, data-og-hydratd'
		}
	]);
	document.body.innerHTML = '';
	expect(markup()).toEqual([]);
});

test('no failure without a code: a STALE rejection, an ogygia error with no code page', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	window.dispatchEvent(
		new PromiseRejectionEvent('unhandledrejection', {
			promise: Promise.resolve(),
			reason: new Error('[ogygia] https://ogygiajs.dev/e/goto_not_http')
		})
	);
	window.dispatchEvent(
		new PromiseRejectionEvent('unhandledrejection', {
			promise: Promise.resolve(),
			reason: new Error('not ours')
		})
	);
	expect(rules()).toEqual([]);
	window.dispatchEvent(
		new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: STALE })
	);
	window.dispatchEvent(
		new PromiseRejectionEvent('unhandledrejection', {
			promise: Promise.resolve(),
			reason: new Error('[ogygia] something went wrong')
		})
	);
	expect(rules()).toEqual([
		{
			code: 'rule_failure_uncoded',
			detail:
				'a STALE escaped as a rejection; an ogygia error with no code: [ogygia] something went wrong'
		}
	]);
	// dev: a machine move asks for a check, and what is broken is said with its code, once
	const { machine } = await import('@ogygia/machine');
	const m = machine<{ a: {}; b: {} }>()({
		name: 'probe',
		initial: 'a',
		steps: { a: ['b'], b: [] }
	}).create();
	m.go('b');
	await tick(10);
	const said = warn.mock.calls
		.map((c) => String(c[0]))
		.filter((s) => s.includes('rule_failure_uncoded'));
	expect(said).toHaveLength(1);
});
