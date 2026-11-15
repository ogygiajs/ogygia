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

type Props = Record<string, unknown>;

/** Where in the page a region renders: what the regions above it set. */
export const AT = ['page', 'island', 'live-snippet', 'lake', 'answer', 'woken-answer'] as const;
/** The render root above it: none (an isolated render), Kit's page pass, a region below a region in
 *  Kit's pass, or a root ogygia started (its own render, with the request's event). */
export const KIT = ['none', 'pass', 'pass-inner', 'ogygia'] as const;
/** Whether the document is one Kit hydrates (csr=true). */
export const CSR = ['off', 'on'] as const;
/** A page render, or an error page's. */
export const PAGE = ['ok', 'error'] as const;
export const ENV = ['dev', 'prod'] as const;

export type Place = {
	at: (typeof AT)[number];
	kit: (typeof KIT)[number];
	csr: (typeof CSR)[number];
	page: (typeof PAGE)[number];
	env: (typeof ENV)[number];
};

/** Every place, in a fixed order. */
export const PLACES: readonly Place[] = product({
	at: AT,
	kit: KIT,
	csr: CSR,
	page: PAGE,
	env: ENV
}) as Place[];

export function place_name(p: Place): string {
	return `at=${p.at} kit=${p.kit} csr=${p.csr} page=${p.page} env=${p.env}`;
}

/** The cartesian product of `axes`, the first axis slowest. */
export function product<K extends string>(
	axes: Record<K, readonly string[]>
): Array<Record<K, string>> {
	let out: Array<Record<string, string>> = [{}];
	for (const [name, values] of Object.entries(axes) as Array<[K, readonly string[]]>) {
		const next: Array<Record<string, string>> = [];
		for (const row of out) for (const v of values) next.push({ ...row, [name]: v });
		out = next;
	}
	return out as Array<Record<K, string>>;
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

/** An island's wake settings, as the compiler writes them. */
function wake_of(w: string): Props {
	switch (w) {
		case 'load':
		case 'idle':
		case 'visible':
		case 'interaction':
			return { wake: w };
		case 'visible-margin':
			return { wake: 'visible', wakeMargin: '200px' };
		case 'media':
			return { wake: '(min-width: 600px)' };
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

export type Kind = {
	/** The axes, in name order; each value list in a fixed order. */
	axes: Record<string, readonly string[]>;
	/** Axes the harness reads on the server only (no client counterpart). */
	server_only?: readonly string[];
	/** Region's props for one combination. */
	props(v: Record<string, string>): Props;
	/** What the request knows, for one combination. */
	request?(v: Record<string, string>): Partial<Request>;
};

const WAKES = ['load', 'idle', 'visible', 'visible-margin', 'interaction', 'media'] as const;
const HELD_WAKES = ['none', 'load', 'idle', 'visible', 'interaction', 'media'] as const;
const PROPS = ['absent', 'empty', 'json', 'devalue', 'snippet', 'live', 'ref'] as const;
const SNIPPETS = ['none', 'text', 'island', 'hole'] as const;

export const KINDS: Readonly<Record<string, Kind>> = {
	island: {
		axes: {
			wake: WAKES,
			keep: ['none', 'nav'],
			children: SNIPPETS,
			component: ['tiny', 'wrap', 'late', 'tiny+late'],
			props: PROPS,
			ttl: ['0', '60'],
			known: ['no', 'yes']
		},
		server_only: ['known'],
		props: (v) => ({
			__og: {
				mode: 'island',
				entry: '/islands/tiny.js',
				...wake_of(v.wake),
				...(v.keep === 'none' ? {} : { keep: v.keep }),
				...(v.component === 'late'
					? {}
					: { component: (v.component === 'wrap' ? Wrap : Tiny) as Component }),
				...(v.component.endsWith('late') ? { load: () => Promise.resolve(Tiny) } : {}),
				...(v.ttl === '0' ? {} : { cacheTtl: Number(v.ttl) })
			},
			__props: props_of(v.props),
			children: snippet_of(v.children, '<i>kid</i>')
		}),
		request: (v) => ({ known: v.known === 'yes' })
	},
	hole: {
		axes: {
			when: ['load', 'idle', 'visible'],
			wake: ['none', 'module-only', 'load', 'idle', 'visible', 'interaction', 'media'],
			attrs: ['none', 'all'],
			ttl: ['0', '60'],
			fallback: SNIPPETS,
			props: ['absent', 'empty', 'json', 'devalue', 'snippet'],
			component: ['tiny', 'none'],
			building: ['no', 'yes'],
			page_version: ['no', 'yes']
		},
		server_only: ['building', 'page_version'],
		props: (v) => ({
			__og: {
				mode: 'server',
				entry: 'hole-a',
				...(v.component === 'tiny' ? { component: Tiny } : {}),
				when: v.when,
				...(v.wake === 'none'
					? {}
					: v.wake === 'module-only'
						? { module: '/islands/hole.js' }
						: { wake: held_wake(v.wake), module: '/islands/hole.js' }),
				...(v.attrs === 'all'
					? { margin: '10px', wakeMargin: '50px', stitch: 'edge', prefetch: 'idle' }
					: {}),
				...(v.ttl === '0' ? {} : { cacheTtl: Number(v.ttl) })
			},
			__props: props_of(v.props),
			ogygiaFallback: snippet_of(v.fallback, '<p>wait</p>')
		}),
		request: (v) => ({ building: v.building === 'yes', page_version: v.page_version === 'yes' })
	},
	lake: {
		axes: {
			remount: ['cache', 'empty', 'swr'],
			when: ['none', 'idle'],
			max_age: ['none', '30'],
			on_expire: ['none', 'empty', 'fetch'],
			margin: ['none', '5px'],
			children: SNIPPETS,
			props: PROPS
		},
		props: (v) => ({
			__og: {
				mode: 'lake',
				entry: 'lake-a',
				remount: v.remount,
				...(v.when === 'none' ? {} : { when: v.when }),
				...(v.max_age === 'none' ? {} : { maxAge: Number(v.max_age) }),
				...(v.on_expire === 'none' ? {} : { onExpire: v.on_expire }),
				...(v.margin === 'none' ? {} : { margin: v.margin })
			},
			__props: props_of(v.props),
			children: snippet_of(v.children, '<p>lake</p>')
		})
	},
	inline: {
		axes: {
			content: ['none', 'post-1', 'unknown'],
			component: ['tiny', 'wrap'],
			children: SNIPPETS,
			placeholder: ['none', 'text']
		},
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
		axes: {
			wake: HELD_WAKES,
			margin: ['none', '9px'],
			thenable: ['no', 'yes'],
			module: ['dual', 'none'],
			component: ['tiny', 'wrap'],
			children: SNIPPETS,
			placeholder: ['none', 'text']
		},
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
		axes: {
			html: ['none', 'live'],
			baked: ['no', 'yes'],
			wake: HELD_WAKES,
			margin: ['none', '3px'],
			module: ['none', 'held'],
			children: SNIPPETS,
			placeholder: ['none', 'text']
		},
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
			...(v.baked === 'yes' ? { __og: { baked: true } } : {}),
			children: snippet_of(v.children, '<p>kid</p>'),
			placeholder: snippet_of(v.placeholder, '<p>wait</p>')
		})
	},
	promise: {
		axes: {
			settles: ['never', 'live', 'deferred', 'rejects'],
			children: SNIPPETS,
			placeholder: ['none', 'text']
		},
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
		axes: { children: SNIPPETS, placeholder: ['none', 'text'] },
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
		'og.baked',
		'og.when',
		'og.margin',
		'og.stitch',
		'og.prefetch',
		'ogygiaFallback',
		'og.remount',
		'og.maxAge',
		'og.onExpire',
		'og.css'
	],
	hole: [
		'og.keep',
		'og.load',
		'children',
		'placeholder',
		'og.baked',
		'og.remount',
		'og.maxAge',
		'og.onExpire',
		'og.css'
	],
	lake: [
		'og.wake',
		'og.wakeMargin',
		'og.keep',
		'og.component',
		'og.load',
		'og.stitch',
		'og.prefetch',
		'ogygiaFallback',
		'placeholder',
		'og.baked',
		'og.cacheTtl',
		'og.css'
	]
};
const HELD_FOREIGN = [
	'og.wake',
	'og.wakeMargin',
	'og.entry',
	'og.component',
	'og.load',
	'__props',
	'og.when',
	'og.margin',
	'og.stitch',
	'og.prefetch',
	'ogygiaFallback',
	'og.remount',
	'og.maxAge',
	'og.onExpire',
	'og.css'
];
for (const k of ['inline', 'dual', 'deferred', 'promise', 'nothing'])
	(FOREIGN as Record<string, readonly string[]>)[k] = HELD_FOREIGN;
/** Props of another kind each kind reads all the same: never written together by the compiler. */
export const MIXED: readonly string[] = [
	'of',
	'og.keep',
	'og.cacheTtl',
	'og.wake',
	'og.module',
	'og.baked',
	'children',
	'placeholder'
];

/** A foreign or mixed prop's value, made fresh. */
export function stray_value(name: string): unknown {
	switch (name) {
		case 'og.wakeMargin':
			return '50px';
		case 'og.baked':
			return true;
		case 'og.component':
			return Wrap;
		case 'og.load':
			return () => Promise.resolve(Wrap);
		case '__props':
			return { stray: 1 };
		case 'ogygiaFallback':
		case 'placeholder':
		case 'children':
			return text('<em>stray</em>');
		case 'og.maxAge':
		case 'og.cacheTtl':
			return 9;
		case 'og.css':
			return { css: 'stray' };
		case 'of':
			return brand({ kind: 'deferred', id: 'stray', props: {}, url: '/stray', module: '' });
		case 'og.entry':
			return '/islands/stray.js';
		case 'og.module':
			return '/islands/stray-module.js';
		case 'og.when':
		case 'og.wake':
			return 'idle';
		case 'og.remount':
			return 'swr';
		case 'og.onExpire':
			return 'fetch';
		default:
			return `stray-${name}`;
	}
}

/** Set one input on a region's props: `og.<key>` is a field of its settings (`__og`), any other
 *  name a prop of its own. */
export function put_input(p: Props, name: string, value: unknown): void {
	if (name.startsWith('og.')) p.__og = { ...(p.__og as Props | undefined), [name.slice(3)]: value };
	else p[name] = value;
}

/** A region's settings (`__og`), as plain data: empty when it has none. */
export function settings_of(p: Props): Props {
	return (p.__og as Props | undefined) ?? {};
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
	for (const [name, value] of Object.entries(s.raw)) put_input(p, name, value);
	if (Object.keys(s.of_raw).length && p.of && typeof p.of === 'object')
		Object.assign(p.of as Props, s.of_raw);
	if (stray) for (const name of s.stray) put_input(p, name, stray_value(name));
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
