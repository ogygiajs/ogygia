// THE REGION GRID: every input Region reads, as axes, and every combination of them. A case is one
// kind of region (a placed island, a hole, a lake, a held value of each kind, a promise, nothing)
// with one value on each of its kind's axes, rendered at one PLACE (where in the page, under which
// root, on which document, in dev or production). The server grid, the client grid, the hydration
// grid and the fuzz all build their cases here, so the four see the same inputs.
//
// The axes are the inputs Region's code reads for a kind. A prop a kind never reads (a wake on a
// lake, a fallback on an island) is not an axis of that kind: the fuzz proves each one changes
// nothing (region-grid-fuzz.test.ts › "a prop its kind does not read changes nothing").
import { createRawSnippet, type Component } from 'svelte';
import Tiny from './_fixtures/Tiny.svelte';
import Wrap from './_fixtures/Wrap.svelte';
import * as GridSnippets from './_fixtures/GridSnippets.svelte';
import { REGION_BRAND } from '../src/region.ts';
import { og_portable } from '../src/region-snippet.ts';
import { KIND_AXES, product, type KindAxes, type Place } from './_region-grid-axes.ts';

export {
	AT,
	CSR,
	ENV,
	KIT,
	PAGE,
	PLACES,
	product,
	type ClientPlace,
	type Place
} from './_region-grid-axes.ts';

type Props = Record<string, unknown>;

export function place_name(p: Place): string {
	return `at=${p.at} kit=${p.kit} csr=${p.csr} page=${p.page} env=${p.env}`;
}

/** A page's data an island's props can point into (a seed reference on Kit's pass). */
export const PAGE_DATA = {
	card: {
		title: 'a card the page loaded, long enough to be worth a reference',
		body: 'and a body, so the node clears the size a reference needs',
		n: 7
	}
};
export const LIVE_ENTRY = '/_app/ogygia/og-region.abc123.js';

const text = (html: string) => createRawSnippet(() => ({ render: () => html }));
const { island_in, hole_in } = GridSnippets as unknown as { island_in: unknown; hole_in: unknown };

/** A snippet axis value: none, a text snippet, a snippet holding an island, or one holding a hole. */
function snippet_of(v: string, html: string): unknown {
	return v === 'none'
		? undefined
		: v === 'text'
			? text(html)
			: v === 'island'
				? island_in
				: hole_in;
}

/** Props of each shape: absent, empty, plain JSON, devalue-only, a snippet, a live snippet, a
 *  reference into the page's data. Made fresh per case: a live snippet brands its function. */
function props_of(shape: string): Props | undefined {
	switch (shape) {
		case 'absent':
			return undefined;
		case 'empty':
			return {};
		case 'json':
			return { n: 1, s: 'a' };
		case 'devalue':
			return { d: new Date(0), m: new Map([[1, 2]]) };
		case 'snippet':
			return { s: text('<u>s</u>') };
		case 'live':
			return { s: og_portable(text('<u>live</u>') as never, Tiny, { k: 1 }, LIVE_ENTRY) };
		case 'ref':
			return { card: PAGE_DATA.card };
	}
	throw new Error(`no props shape ${shape}`);
}

/** An island's wake props: one of the five, as the compiler writes them. */
function wake_of(w: string): Props {
	switch (w) {
		case 'load':
			return { load: true };
		case 'idle':
			return { idle: true };
		case 'visible':
			return { visible: true };
		case 'visible-margin':
			return { visible: '200px' };
		case 'interaction':
			return { interaction: true };
		case 'media':
			return { media: '(min-width: 600px)' };
	}
	throw new Error(`no wake ${w}`);
}

/** A held value's wake: none, or the schedule a `region()` value carries. */
function held_wake(w: string): string | undefined {
	return w === 'none' ? undefined : w === 'media' ? '(min-width: 600px)' : w;
}

const brand = (v: Props): Props => ({ [REGION_BRAND]: true, ...v });

/** The values of each case the harness reads, not Region's props: what the server knows of the
 *  request (a navigation that names the island's copy, a prerender, a render for another page). */
export type Request = { known: boolean; building: boolean; page_version: boolean };

export type Kind = KindAxes & {
	/** Region's props for one combination. */
	props(v: Record<string, string>): Props;
	/** What the request knows, for one combination. */
	request?(v: Record<string, string>): Partial<Request>;
};

export const KINDS: Readonly<Record<string, Kind>> = {
	island: {
		...KIND_AXES.island,
		props: (v) => ({
			__mode: 'island',
			__entry: '/islands/tiny.js',
			...wake_of(v.wake),
			...(v.keep === 'none' ? {} : { __keep: v.keep }),
			...(v.component === 'late'
				? {}
				: { __component: (v.component === 'wrap' ? Wrap : Tiny) as Component }),
			...(v.component.endsWith('late') ? { __load: () => Promise.resolve(Tiny) } : {}),
			__props: props_of(v.props),
			...(v.ttl === '0' ? {} : { __cacheTtl: Number(v.ttl) }),
			children: snippet_of(v.children, '<i>kid</i>')
		}),
		request: (v) => ({ known: v.known === 'yes' })
	},
	hole: {
		...KIND_AXES.hole,
		props: (v) => ({
			__mode: 'server',
			__entry: 'hole-a',
			...(v.component === 'tiny' ? { __component: Tiny } : {}),
			__props: props_of(v.props),
			__defer: v.when,
			...(v.wake === 'none'
				? {}
				: v.wake === 'module-only'
					? { __module: '/islands/hole.js' }
					: { __hydrate: held_wake(v.wake), __module: '/islands/hole.js' }),
			...(v.attrs === 'all'
				? { __margin: '10px', __hydrateMargin: '50px', __stitch: 'edge', __prefetch: 'idle' }
				: {}),
			...(v.ttl === '0' ? {} : { __cacheTtl: Number(v.ttl) }),
			ogygiaFallback: snippet_of(v.fallback, '<p>wait</p>')
		}),
		request: (v) => ({ building: v.building === 'yes', page_version: v.page_version === 'yes' })
	},
	lake: {
		...KIND_AXES.lake,
		props: (v) => ({
			__mode: 'lake',
			__entry: 'lake-a',
			__remount: v.remount,
			__props: props_of(v.props),
			...(v.when === 'none' ? {} : { __when: v.when }),
			...(v.max_age === 'none' ? {} : { __maxAge: Number(v.max_age) }),
			...(v.on_expire === 'none' ? {} : { __onExpire: v.on_expire }),
			...(v.margin === 'none' ? {} : { __margin: v.margin }),
			children: snippet_of(v.children, '<p>lake</p>')
		})
	},
	inline: {
		...KIND_AXES.inline,
		props: (v) => ({
			of: brand({
				kind: 'inline',
				component: v.component === 'wrap' ? Wrap : Tiny,
				props: { i: 1 },
				...(v.content === 'none' ? {} : { content_id: v.content })
			}),
			children: snippet_of(v.children, '<i>kid</i>'),
			placeholder: snippet_of(v.placeholder, '<p>wait</p>')
		})
	},
	dual: {
		...KIND_AXES.dual,
		props: (v) => {
			const value = brand({
				kind: 'dual',
				component: v.component === 'wrap' ? Wrap : Tiny,
				props: { d: 1 },
				id: 'dual-a',
				module: v.module === 'dual' ? '/islands/dual.js' : '',
				sign: () => '/signed',
				...(v.wake === 'none' ? {} : { hydrate: held_wake(v.wake) }),
				...(v.margin === 'none' ? {} : { hydrateMargin: v.margin })
			});
			// oxlint-disable-next-line unicorn/no-thenable -- an awaitable dual is thenable by design (region.ts AwaitableRegion)
			if (v.thenable === 'yes') value.then = () => {};
			return {
				of: value,
				children: snippet_of(v.children, '<i>kid</i>'),
				placeholder: snippet_of(v.placeholder, '<p>wait</p>')
			};
		}
	},
	deferred: {
		...KIND_AXES.deferred,
		props: (v) => ({
			of: brand({
				kind: 'deferred',
				id: 'held-a',
				props: { h: 1 },
				url: '/__ogygia__?id=held-a',
				module: v.module === 'held' ? '/islands/held.js' : '',
				...(v.html === 'none' ? {} : { html: '<b>live</b>' }),
				...(v.wake === 'none' ? {} : { hydrate: held_wake(v.wake) }),
				...(v.margin === 'none' ? {} : { hydrateMargin: v.margin })
			}),
			...(v.baked === 'yes' ? { __baked: true } : {}),
			children: snippet_of(v.children, '<p>kid</p>'),
			placeholder: snippet_of(v.placeholder, '<p>wait</p>')
		})
	},
	promise: {
		...KIND_AXES.promise,
		props: (v) => ({
			of:
				v.settles === 'never'
					? new Promise(() => {})
					: v.settles === 'rejects'
						? quiet_reject()
						: Promise.resolve(
								brand({
									kind: 'deferred',
									id: 'held-p',
									props: {},
									url: '/__ogygia__?id=held-p',
									module: '',
									...(v.settles === 'live' ? { html: '<b>late</b>' } : {})
								})
							),
			children: snippet_of(v.children, '<p>kid</p>'),
			placeholder: snippet_of(v.placeholder, '<p>wait</p>')
		})
	},
	nothing: {
		...KIND_AXES.nothing,
		props: (v) => ({
			children: snippet_of(v.children, '<p>kid</p>'),
			placeholder: snippet_of(v.placeholder, '<p>wait</p>')
		})
	}
};

/** A promise that rejects, already handled: a region's own catch is what the grid watches. */
function quiet_reject(): Promise<never> {
	const p = Promise.reject(new Error('the remote call failed'));
	p.catch(() => {}); // oxlint-disable-line ogygia/no-silent-failures -- the region under test reports it; this only stops Node's unhandled-rejection exit
	return p;
}

/** One case: a kind, one value per axis, its name (every axis, in order). */
export type GridCase = { kind: string; values: Record<string, string>; name: string };

/** Every case of `kind`, in a fixed order; on the client, without the server-only axes. */
export function cases_of(kind: string, leg: 'server' | 'client' = 'server'): GridCase[] {
	const k = KINDS[kind];
	const axes =
		leg === 'server'
			? k.axes
			: Object.fromEntries(
					Object.entries(k.axes).filter(([name]) => !k.server_only?.includes(name))
				);
	return product(axes).map((values) => ({
		kind,
		values,
		name: `kind=${kind} ${Object.entries(values)
			.map(([a, v]) => `${a}=${v}`)
			.join(' ')}`
	}));
}

/** The case's region props, made fresh (a snippet is a per-render value). */
export function props_for(c: GridCase): Props {
	const p = KINDS[c.kind].props(c.values);
	for (const key of Object.keys(p)) if (p[key] === undefined) delete p[key];
	return p;
}

export function request_for(c: GridCase): Request {
	return {
		known: false,
		building: false,
		page_version: false,
		...KINDS[c.kind].request?.(c.values)
	};
}

/**
 * The props each kind never reads (Region's code for that kind does not look at them): set on a
 * case, they must change nothing. And the props it does read though the compiler never writes
 * them with that kind (a mixed input): the fuzz checks those still render good HTML, unthrown.
 */
export const FOREIGN: Readonly<Record<string, readonly string[]>> = {
	island: [
		'placeholder',
		'__baked',
		'__defer',
		'__margin',
		'__hydrateMargin',
		'__stitch',
		'__prefetch',
		'ogygiaFallback',
		'__remount',
		'__when',
		'__maxAge',
		'__onExpire',
		'__css',
		'__module'
	],
	hole: [
		'visible',
		'idle',
		'media',
		'load',
		'interaction',
		'__keep',
		'__load',
		'children',
		'placeholder',
		'__baked',
		'__remount',
		'__when',
		'__maxAge',
		'__onExpire',
		'__css'
	],
	lake: [
		'visible',
		'idle',
		'media',
		'load',
		'interaction',
		'__keep',
		'__component',
		'__load',
		'__defer',
		'__hydrateMargin',
		'__stitch',
		'__prefetch',
		'ogygiaFallback',
		'placeholder',
		'__baked',
		'__cacheTtl',
		'__css',
		'__module'
	]
};
const HELD_FOREIGN = [
	'visible',
	'idle',
	'media',
	'load',
	'interaction',
	'__entry',
	'__component',
	'__load',
	'__props',
	'__defer',
	'__margin',
	'__hydrateMargin',
	'__stitch',
	'__prefetch',
	'ogygiaFallback',
	'__remount',
	'__when',
	'__maxAge',
	'__onExpire',
	'__css',
	'__module'
];
for (const k of ['inline', 'dual', 'deferred', 'promise', 'nothing'])
	(FOREIGN as Record<string, readonly string[]>)[k] = HELD_FOREIGN;
/** Props of another kind each kind reads all the same: never written together by the compiler. */
export const MIXED: readonly string[] = [
	'of',
	'__keep',
	'__cacheTtl',
	'__hydrate',
	'__module',
	'__baked',
	'children',
	'placeholder'
];

/** A foreign or mixed prop's value, made fresh. */
export function stray_value(name: string): unknown {
	switch (name) {
		case 'visible':
			return '50px';
		case 'media':
			return '(max-width: 1px)';
		case 'idle':
		case 'load':
		case 'interaction':
		case '__baked':
			return true;
		case '__component':
			return Wrap;
		case '__load':
			return () => Promise.resolve(Wrap);
		case '__props':
			return { stray: 1 };
		case 'ogygiaFallback':
		case 'placeholder':
		case 'children':
			return text('<em>stray</em>');
		case '__maxAge':
		case '__cacheTtl':
			return 9;
		case '__css':
			return { css: 'stray' };
		case 'of':
			return brand({ kind: 'deferred', id: 'stray', props: {}, url: '/stray', module: '' });
		case '__entry':
			return '/islands/stray.js';
		case '__module':
			return '/islands/stray-module.js';
		case '__defer':
		case '__when':
			return 'idle';
		case '__remount':
			return 'swr';
		case '__onExpire':
			return 'fetch';
		case '__hydrate':
			return 'idle';
		default:
			return `stray-${name}`;
	}
}

/** One fuzzed input, as plain data (it crosses to the server leg of the hydration fuzz as JSON):
 *  a grid case, raw values over some of its props (or its held value's fields), and stray props. */
export type Spec = {
	kind: string;
	values: Record<string, string>;
	raw: Record<string, unknown>;
	of_raw: Record<string, unknown>;
	stray: string[];
};

export function spec_case(s: Spec): GridCase {
	return {
		kind: s.kind,
		values: s.values,
		name: `kind=${s.kind} ${Object.entries(s.values)
			.map(([a, v]) => `${a}=${v}`)
			.join(' ')}`
	};
}

/** The region props a spec makes, fresh each call: the case's, its raw values over them, then its
 *  stray props (left out when `stray` is false). */
export function spec_props(s: Spec, stray = true): Props {
	const p = props_for(spec_case(s));
	Object.assign(p, s.raw);
	if (Object.keys(s.of_raw).length && p.of && typeof p.of === 'object')
		Object.assign(p.of as Props, s.of_raw);
	if (stray) for (const name of s.stray) p[name] = stray_value(name);
	return p;
}

/** The message code of a coded refusal (an `OgygiaError` naming `ogygiajs.dev/e/<code>`): a
 *  combination Region rejects. Null for no throw, or a throw with no code (a bug). */
export function rejected_code(thrown: string | null): string | null {
	return thrown ? (/ogygiajs\.dev\/e\/([a-z0-9_]+)/.exec(thrown)?.[1] ?? null) : null;
}

/** How many cases each kind has, on a leg. */
export function counts(leg: 'server' | 'client' = 'server'): Record<string, number> {
	return Object.fromEntries(Object.keys(KINDS).map((k) => [k, cases_of(k, leg).length]));
}
