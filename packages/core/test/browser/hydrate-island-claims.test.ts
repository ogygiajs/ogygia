// The hydrate step's other claims, each on its own: what it reads before the island renders, which
// islands are not its to hydrate, what it hands the island, what it owns, and how it ends.
import { afterEach, beforeAll, beforeEach, expect, inject, test, vi } from 'vitest';
import type { Component } from 'svelte';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { load_devalue } from '../../src/runtime/devalue-lane.ts';
import { install as install_live } from '../../src/runtime/live.ts';
import { install as install_lakes } from '../../src/runtime/lakes.ts';
import { slots } from '../../src/runtime/slots.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { ids_released } from '../../src/runtime/region-ids.ts';
import { resolve_sink } from '../../src/ref-sink.ts';
import { current_region } from '../../src/current-region.ts';
import {
	absorb_region_props,
	hydrate_island,
	hydrate_live,
	read_region_props
} from '../../src/runtime/hydrate-core.ts';
import Counter from './fixtures/Counter.svelte';
import ContextProbe from './fixtures/ContextProbe.svelte';
import { claims } from './_walk.ts';

type Mod = { default: Component<Record<string, unknown>> };
const as_mod = (c: unknown): Mod => ({ default: c as Component<Record<string, unknown>> });
const decode = (key: 'counter_render_b64' | 'counter_ssr_b64') =>
	decodeURIComponent(escape(atob(inject(key))));

let said: string[] = [];
const codes = (code: string) => said.filter((s) => s.includes(code));
let kit_page: boolean | undefined;
let saved = { ...slots };

/** A region holding `html`, in the page (or not), with `attrs`. */
function region_with(
	html: string,
	attrs: Record<string, string> = {},
	connected = true
): HTMLElement {
	const el = document.createElement('ogygia-region');
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	el.innerHTML = html;
	if (connected) document.body.append(el);
	return el;
}
/** A props sidecar after `region`, its text as given (devalue). */
function sidecar_after(region: Element, text: string): HTMLScriptElement {
	const s = document.createElement('script');
	s.setAttribute('data-ogygia-props', '');
	s.type = 'application/json';
	s.textContent = text;
	region.after(s);
	return s;
}

beforeAll(async () => {
	link_boot();
	await load_devalue();
	install_live();
	install_lakes();
	kit_page = runtime_session.kit_page;
	saved = { ...slots };
});
beforeEach(() => {
	document.body.innerHTML = '';
	said = [];
	runtime_session.kit_page = false;
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		said.push(a.map(String).join(' '));
	});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	Object.assign(slots, saved);
	runtime_session.kit_page = kit_page;
	delete (globalThis as { __og_probe_context?: unknown }).__og_probe_context;
	document.head.querySelectorAll('[data-test-island-head]').forEach((n) => n.remove());
});

test('server nodes with no anchor pair around them get one, and are adopted', () => {
	const html = decode('counter_render_b64');
	expect(html.startsWith('<!--[-->') && html.endsWith('<!--]-->')).toBe(true);
	const region = region_with(html.slice('<!--[-->'.length, -'<!--]-->'.length));
	const button = region.querySelector('button');
	expect(hydrate_island(region, '/counter', as_mod(Counter), null, false)).not.toBeNull();
	expect(region.querySelector('button')).toBe(button);
	expect(region.hasAttribute('data-og-recovered')).toBe(false);
});

test('the page’s seeds are read before the island renders, on both hydrate paths', () => {
	const order: string[] = [];
	slots.page = { ...saved.page!, seed_page_once: () => void order.push('page') };
	slots.remoteSeeds = { ...saved.remoteSeeds!, seed_once: () => void order.push('remote') };
	const island = claims(1, () => order.push('island'));
	hydrate_island(region_with('<!--[--><p>a</p><!--]-->'), '/a', island, null, false);
	expect(order).toEqual(['remote', 'page', 'island']);
	order.length = 0;
	hydrate_live(region_with('<!--[--><p>a</p><!--]-->'), '/a', island, {});
	expect(order).toEqual(['remote', 'page', 'island']);
});

test('an app with no page feature and no remote seeds hydrates all the same', () => {
	slots.page = null as never;
	slots.remoteSeeds = null;
	const region = region_with('<!--[--><p>a</p><!--]-->');
	expect(hydrate_island(region, '/a', claims(1), null, false)).not.toBeNull();
});

test('a seed reference reads the seed of the document its props came from', () => {
	slots.page = {
		...saved.page!,
		seed_data_of: (doc: Document) => ({ counter: doc === document ? 'live page' : 'next page' })
	};
	const next = document.implementation.createHTMLDocument('');
	const sidecar = next.createElement('script');
	sidecar.setAttribute('data-ogygia-props', '');
	sidecar.textContent = '[{"start":1},["OgygiaSeedRef",2],[3],"counter"]';
	next.body.append(sidecar);
	expect(read_region_props(region_with(''), false, sidecar)).toEqual({ start: 'next page' });
});

test('on a page Kit hydrates, a placed island is Kit’s: not hydrated, marked, and said in dev', () => {
	runtime_session.kit_page = true;
	const region = region_with('<!--[--><p>a</p><!--]-->');
	expect(hydrate_island(region, '/kit', claims(1), null, false)).toBeNull();
	expect(region.hasAttribute('data-kit-hydrated')).toBe(true);
	expect(codes('island_on_kit_page')).toHaveLength(1);
});

test('on a page Kit hydrates, what an island of ours puts in the head is not taken as the island’s', () => {
	runtime_session.kit_page = true;
	const meta = document.createElement('meta');
	meta.setAttribute('data-test-island-head', '');
	const island = claims(1, () => document.head.append(meta));
	hydrate_island(
		region_with('<!--[--><p>a</p><!--]-->', { render: 'defer' }),
		'/k',
		island,
		null,
		false
	);
	expect(runtime_session.island_head.has(meta)).toBe(false);
	runtime_session.kit_page = false;
	const other = document.createElement('meta');
	other.setAttribute('data-test-island-head', '');
	hydrate_island(
		region_with('<!--[--><p>a</p><!--]-->'),
		'/k',
		claims(1, () => document.head.append(other)),
		null,
		false
	);
	expect(runtime_session.island_head.has(other)).toBe(true);
});

test('a block island the parser hoisted out of a paragraph is said in dev; a fetched answer is not', () => {
	hydrate_island(region_with('<!--[-->'), '/inline', claims(0), null, false);
	expect(codes('island_block_in_inline')).toHaveLength(1);
	said = [];
	hydrate_island(region_with('<!--[-->', { render: 'defer' }), '/inline', claims(0), null, false);
	expect(codes('island_block_in_inline')).toHaveLength(0);
});

test('an island nobody touched while it slept is not compared with its server copy', () => {
	const region = region_with('<!--[--><p>a</p><!--]-->');
	const ssr = region.innerHTML;
	region.prepend(document.createElement('style'));
	hydrate_island(region, '/a', claims(1), ssr, false);
	expect(region.hasAttribute('data-og-healed')).toBe(false);
});

test('an island taken off the page before its hydrate is left as it is, and its head watch ends', () => {
	const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
	const region = region_with('<!--[--><p>a</p><!--]-->', {}, false);
	const ssr = region.innerHTML;
	region.prepend(document.createElement('style'));
	const live = region.innerHTML;
	expect(hydrate_island(region, '/a', claims(1), ssr, true)).toBeNull();
	expect(region.innerHTML).toBe(live);
	expect(disconnect).toHaveBeenCalled();
});

test('a kept island on a page without the router is said in dev; with it, not', () => {
	hydrate_island(
		region_with('<!--[--><p>a</p><!--]-->', { 'data-ogygia-keep': 'k' }),
		'/keep',
		claims(1),
		null,
		false
	);
	expect(codes('keep_without_router')).toHaveLength(1);
	said = [];
	const meta = document.createElement('meta');
	meta.name = 'ogygia-router';
	document.head.append(meta);
	try {
		hydrate_island(
			region_with('<!--[--><p>a</p><!--]-->', { 'data-ogygia-keep': 'k' }),
			'/keep',
			claims(1),
			null,
			false
		);
		expect(codes('keep_without_router')).toHaveLength(0);
	} finally {
		meta.remove();
	}
});

test('a <Provide> above the island reaches its context, on both hydrate paths', () => {
	slots.context = () => new Map([['probe', 'provided']]);
	hydrate_island(region_with(''), '/ctx', as_mod(ContextProbe), null, false);
	expect((globalThis as { __og_probe_context?: unknown }).__og_probe_context).toBe('provided');
	delete (globalThis as { __og_probe_context?: unknown }).__og_probe_context;
	hydrate_live(region_with(''), '/ctx', as_mod(ContextProbe), {});
	expect((globalThis as { __og_probe_context?: unknown }).__og_probe_context).toBe('provided');
});

/** Is `id` held by a region on the page (not released when nothing departs)? */
const held = (id: string) => ids_released([id], [], document, {}).length === 0;

test('the hub ids an island resolves from its props and its provided context are its region’s', () => {
	slots.wire = {
		...saved.wire!,
		REF_WIRE_KEY: 'TestRef',
		resolve: (d: never) => {
			resolve_sink?.(String(d));
			return d;
		}
	} as never;
	slots.context = () => {
		resolve_sink?.('from-context');
		return undefined;
	};
	const region = region_with('<!--[--><p>a</p><!--]-->');
	sidecar_after(region, '[{"r":1},["TestRef",2],"from-props"]');
	hydrate_island(region, '/ids', claims(1), null, false);
	expect(held('from-props')).toBe(true);
	expect(held('from-context')).toBe(true);
	const live = region_with('');
	hydrate_live(live, '/ids', claims(0), {});
	const kept = region_with('');
	const twin = sidecar_after(region_with(''), '[{"r":1},["TestRef",2],"from-twin"]');
	absorb_region_props(kept, twin);
	twin.previousElementSibling!.remove();
	expect(held('from-twin')).toBe(true);
	region.remove();
	expect(held('from-props'), 'gone with its region').toBe(false);
});

test('while a live region hydrates it is the current region; after, none is', () => {
	let during: Element | null = null;
	const region = region_with('<!--[--><p>a</p><!--]-->');
	hydrate_live(
		region,
		'/live',
		claims(1, () => (during = current_region())),
		{}
	);
	expect(during).toBe(region);
	expect(current_region()).toBeNull();
});

test('the plugins around Svelte’s hydrate run before it and after it, on both paths', () => {
	const order: string[] = [];
	slots.hooks = {
		regionHydrate: () => {
			order.push('before');
			return () => void order.push('after');
		}
	};
	const island = claims(1, () => order.push('hydrate'));
	hydrate_island(region_with('<!--[--><p>a</p><!--]-->'), '/p', island, null, false);
	expect(order).toEqual(['before', 'hydrate', 'after']);
	order.length = 0;
	hydrate_live(region_with('<!--[--><p>a</p><!--]-->'), '/p', island, {});
	expect(order).toEqual(['before', 'hydrate', 'after']);
});

test('a live region with no live feature in the build is not hydrated, and dev says so', () => {
	slots.Pushable = null as never;
	expect(hydrate_live(region_with(''), '/l', claims(0), {})).toBeNull();
	expect(codes('live_feature_missing')).toHaveLength(1);
});

test('a wired prop in a build with no wire feature fails naming the cause', () => {
	slots.wire = null as never;
	const region = region_with('');
	sidecar_after(region, '[{"r":1},["OgygiaRef",2],"x"]');
	expect(() => read_region_props(region)).toThrow(/no wire feature in this build/);
});

test('an island whose hydrate throws gets its lakes back', () => {
	const region = region_with(
		'<!--[--><p>a</p><ogygia-region wake="none" entry="lk"><b>lake</b></ogygia-region><!--]-->'
	);
	// (an error of Svelte's own: its hydrate re-throws it as it is, the region left in place)
	const breaks = as_mod(() => {
		throw new Error('effect_orphan\nhttps://svelte.dev/e/effect_orphan');
	});
	expect(() => hydrate_island(region, '/b', breaks, null, false)).toThrow();
	expect(region.querySelector('ogygia-region b')?.textContent).toBe('lake');
});

test('an island taken off the page while it hydrates is let go', () => {
	const unmount = vi.fn();
	const region = region_with('<p>peer</p>');
	const peer = {
		default: Counter as unknown as Component<Record<string, unknown>>,
		__og_hydrate: () => {
			region.remove();
			return { app: true };
		},
		__og_unmount: unmount
	};
	expect(hydrate_island(region, 'https://peer.example.com/w.js', peer, null, false)).toBeNull();
	expect(unmount).toHaveBeenCalledTimes(1);
});

test('an island whose teardown throws is still torn down, and the error is reported', () => {
	const report = vi.fn();
	vi.stubGlobal('reportError', report);
	try {
		const peer = {
			default: Counter as unknown as Component<Record<string, unknown>>,
			__og_hydrate: () => ({ app: true }),
			__og_unmount: () => {
				throw new Error('onDestroy threw');
			}
		};
		const h = hydrate_island(
			region_with('<p>peer</p>'),
			'https://peer.example.com/w.js',
			peer,
			null,
			false
		)!;
		expect(() => h.dispose()).not.toThrow();
		expect(report).toHaveBeenCalledWith(new Error('onDestroy threw'));
	} finally {
		vi.unstubAllGlobals();
	}
});
