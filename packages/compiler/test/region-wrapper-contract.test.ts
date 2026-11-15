import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import {
	island_wrapper_client_source,
	island_wrapper_source,
	lake_wrapper_source,
	server_wrapper_source
} from '../src/region/emit.ts';
import type { RegionSettings } from '../../core/src/region-plan.ts';
import { set_region_endpoints } from '../../core/test/_stubs/server.region-endpoint.ts';

type Kind = 'string' | 'number' | 'boolean' | 'import';
const SETTINGS = {
	mode: 'string',
	baked: 'boolean',
	wake: 'string',
	wakeMargin: 'string',
	keep: 'string',
	entry: 'string',
	component: 'import',
	css: 'import',
	load: 'import',
	when: 'string',
	margin: 'string',
	module: 'string',
	cacheTtl: 'number',
	stitch: 'string',
	prefetch: 'string',
	remount: 'string',
	maxAge: 'number',
	onExpire: 'string'
} as const satisfies Record<keyof RegionSettings, Kind>;
const REGION_PROPS: ReadonlySet<string> = new Set([
	'__og',
	'__props',
	'children',
	'ogygiaFallback'
]);

const TINY = fileURLToPath(new URL('../../core/test/_fixtures/Tiny.svelte', import.meta.url));
const INTERNAL = fileURLToPath(new URL('../../core/src/internal.ts', import.meta.url));
const ENTRY = 'ogygia:region/entry/abc123.js';
const LAZY = 'ogygia:region/lazy/abc123.js';
const URL_ = '/_app/immutable/og-region.abc123.js';

type Node = { type: string; [key: string]: unknown };
type Program = { body: Node[] };
type Root = {
	module: { content: Program } | null;
	instance: { content: Program } | null;
	fragment: { nodes: Node[] };
};

function read_wrapper(src: string) {
	const root = parse(src, { modern: true }) as unknown as Root;
	const imports = new Map<string, string>();
	let og: Node | null = null;
	for (const s of root.module!.content.body) {
		if (s.type === 'ImportDeclaration')
			for (const spec of s.specifiers as Node[])
				imports.set((spec.local as { name: string }).name, (s.source as { value: string }).value);
		if (s.type === 'VariableDeclaration')
			for (const d of s.declarations as Node[])
				if ((d.id as { name?: string }).name === '__og') og = d.init as Node;
	}
	const bag: Record<string, unknown> = {};
	const names: Record<string, string> = {};
	for (const p of (og?.properties as Node[]) ?? []) {
		const key = (p.key as { name: string }).name;
		const v = p.value as Node;
		if (v.type === 'Identifier') {
			names[key] = v.name as string;
			bag[key] = { from: imports.get(v.name as string) ?? null };
		} else bag[key] = v.value;
	}
	const taken: string[] = [];
	const decl = (root.instance!.content.body[0] as Node).declarations as Node[];
	const id = decl[0]!.id as Node;
	if (id.type === 'Identifier') taken.push(id.name as string);
	else
		for (const p of id.properties as Node[])
			taken.push(
				p.type === 'RestElement'
					? (p.argument as { name: string }).name
					: (p.key as { name: string }).name
			);
	const region = root.fragment.nodes.find(
		(n) => n.type === 'Component' && n.name === 'OgygiaRegion__Wrapper'
	)!;
	const given = (region.attributes as Node[]).map((a) => a.name as string);
	return { bag, names, imports, taken, given, region };
}

const VARIANTS: Array<[name: string, src: string]> = [
	[
		'island, wake load',
		island_wrapper_source('abc123', TINY, ENTRY, 'load', undefined, undefined, URL_)
	],
	[
		'island, wake idle',
		island_wrapper_source('abc123', TINY, ENTRY, 'idle', undefined, undefined, URL_)
	],
	[
		'island, wake visible with a margin',
		island_wrapper_source('abc123', TINY, ENTRY, 'visible', { margin: '200px' }, undefined, URL_)
	],
	[
		'island, wake on a media query, kept',
		island_wrapper_source(
			'abc123',
			TINY,
			ENTRY,
			'(min-width: 600px)',
			{ keep: 'nav' },
			undefined,
			URL_
		)
	],
	[
		'island client leg, wake visible with a margin, kept',
		island_wrapper_client_source('abc123', LAZY, 'visible', { margin: '0px', keep: 'nav' }, URL_)
	],
	['hole', server_wrapper_source('abc123', TINY, ENTRY, {}, undefined, URL_)],
	['hole client leg', server_wrapper_source('abc123', TINY, ENTRY, {}, undefined, URL_, false)],
	[
		'hole with every setting',
		server_wrapper_source(
			'abc123',
			TINY,
			ENTRY,
			{
				when: 'idle',
				stitch: 'edge',
				prefetch: 'hover',
				margin: '10px',
				cacheTtlSec: 60,
				hydrate: 'visible',
				hydrateMargin: '50px'
			},
			undefined,
			URL_
		)
	],
	['lake', lake_wrapper_source('abc123', TINY, undefined, undefined)],
	[
		'lake, swr with every setting',
		lake_wrapper_source(
			'abc123',
			TINY,
			{ remount: 'swr', when: 'visible', margin: '10px', maxAgeMs: 5000, onExpire: 'fetch' },
			undefined
		)
	],
	['lake, max age zero', lake_wrapper_source('abc123', TINY, { maxAgeMs: 0 }, undefined)]
];

describe('every wrapper the compiler writes hands Region only what Region reads', () => {
	for (const [name, src] of VARIANTS)
		it(name, () => {
			const w = read_wrapper(src);
			for (const [key, value] of Object.entries(w.bag)) {
				expect(Object.keys(SETTINGS), `__og.${key}`).toContain(key);
				const kind = SETTINGS[key as keyof typeof SETTINGS];
				if (kind === 'import') expect(w.names[key], `__og.${key}`).toBeDefined();
				else expect(typeof value, `__og.${key}`).toBe(kind);
			}
			for (const [key, local] of Object.entries(w.names))
				expect(w.imports.get(local), `__og.${key} names ${local}, imported nowhere`).toBeTruthy();
			expect(w.imports.get('OgygiaRegion__Wrapper')).toBe('ogygia/internal');
			const named = new Set(Object.values(w.names));
			for (const local of w.imports.keys())
				expect(
					local === 'OgygiaRegion__Wrapper' || local === 'OgygiaLakeInner' || named.has(local),
					`${local} is imported and handed to Region`
				).toBe(true);
			for (const prop of w.given) expect(REGION_PROPS, prop).toContain(prop);
			for (const prop of w.taken) expect(w.given, `${prop} reaches Region`).toContain(prop);
			expect(w.given).toContain('__og');
		});
});

describe("each wrapper's settings, field by field", () => {
	const bag_of = (src: string) => read_wrapper(src).bag;

	it('an island hands Region its mode, wake, entry url, component and the component its css comes from', () => {
		expect(
			bag_of(
				island_wrapper_source(
					'abc123',
					TINY,
					ENTRY,
					'visible',
					{ margin: '200px', keep: 'nav' },
					undefined,
					URL_
				)
			)
		).toEqual({
			mode: 'island',
			wake: 'visible',
			wakeMargin: '200px',
			keep: 'nav',
			entry: URL_,
			component: { from: ENTRY },
			css: { from: TINY }
		});
	});

	it("an island's client leg hands Region its lazy component and its loader, never the component itself", () => {
		expect(
			bag_of(island_wrapper_client_source('abc123', LAZY, 'idle', { keep: 'nav' }, URL_))
		).toEqual({
			mode: 'island',
			wake: 'idle',
			keep: 'nav',
			entry: URL_,
			component: { from: LAZY },
			load: { from: LAZY }
		});
	});

	it('a hole hands Region the id its endpoint is minted for, its component, its css and every fetch setting', () => {
		const options = {
			when: 'idle',
			stitch: 'edge',
			prefetch: 'hover',
			margin: '10px',
			cacheTtlSec: 60,
			hydrate: 'visible',
			hydrateMargin: '50px'
		};
		expect(bag_of(server_wrapper_source('abc123', TINY, ENTRY, options, undefined, URL_))).toEqual({
			mode: 'server',
			entry: 'abc123',
			component: { from: ENTRY },
			css: { from: TINY },
			when: 'idle',
			stitch: 'edge',
			prefetch: 'hover',
			margin: '10px',
			cacheTtl: 60,
			wake: 'visible',
			module: URL_,
			wakeMargin: '50px'
		});
	});

	it("a hole's client leg hands Region its id and schedule, and imports nothing", () => {
		const src = server_wrapper_source('abc123', TINY, ENTRY, {}, undefined, URL_, false);
		const w = read_wrapper(src);
		expect(w.bag).toEqual({ mode: 'server', entry: 'abc123', when: 'load' });
		expect([...w.imports.keys()]).toEqual(['OgygiaRegion__Wrapper']);
	});

	it('a lake hands Region its id, remount, max age (zero included), expiry and an swr schedule', () => {
		expect(
			bag_of(
				lake_wrapper_source(
					'abc123',
					TINY,
					{ remount: 'swr', when: 'visible', margin: '10px', maxAgeMs: 5000, onExpire: 'fetch' },
					undefined
				)
			)
		).toEqual({
			mode: 'lake',
			entry: 'abc123',
			remount: 'swr',
			maxAge: 5000,
			onExpire: 'fetch',
			when: 'visible',
			margin: '10px'
		});
		expect(bag_of(lake_wrapper_source('abc123', TINY, { maxAgeMs: 0 }, undefined))).toEqual({
			mode: 'lake',
			entry: 'abc123',
			remount: 'cache',
			maxAge: 0
		});
	});

	it('a lake renders its component inside Region with the props it was given', () => {
		const { region } = read_wrapper(lake_wrapper_source('abc123', TINY, undefined, undefined));
		const inner = (region.fragment as { nodes: Node[] }).nodes.find((n) => n.type === 'Component')!;
		expect(inner.name).toBe('OgygiaLakeInner');
		const spread = (inner.attributes as Node[])[0]!;
		expect(spread.type).toBe('SpreadAttribute');
		expect((spread.expression as { name: string }).name).toBe('__props');
	});
});

const written: string[] = [];
afterEach(() => set_region_endpoints(null));
afterAll(() => {
	for (const file of written) rmSync(file, { force: true });
});

async function compiled(name: string, src: string): Promise<Component<Record<string, unknown>>> {
	const file = fileURLToPath(new URL(`./_wrapper-${name}.tmp.svelte`, import.meta.url));
	writeFileSync(file, src.replace(`'ogygia/internal'`, JSON.stringify(INTERNAL)));
	written.push(file);
	return (await import(/* @vite-ignore */ file)).default;
}

type Renderer = { push(html: string): void };

describe('the compiled wrappers, rendered on the server through Region', () => {
	it("an island renders its component's HTML inside its element, which names its entry url and wake", async () => {
		const Island = await compiled(
			'island',
			island_wrapper_source('abc123', TINY, TINY, 'idle', undefined, undefined, URL_)
		);
		const { body } = render(Island, { props: { n: 1 } });
		expect(body).toMatch(
			/<ogygia-region entry="\/_app\/immutable\/og-region\.abc123\.js" wake="idle"[^>]*>/
		);
		expect(body).toContain('<b data-tiny="">tiny</b>');
	});

	it('a hole renders its shell with its fallback, its endpoint minted for its id', async () => {
		set_region_endpoints({ mint_server_region: (entry) => `/__ogygia__?id=${entry}` });
		const Hole = await compiled(
			'hole',
			server_wrapper_source('abc123', TINY, TINY, {}, undefined, URL_)
		);
		const ogygiaFallback = (r: Renderer) => r.push('<p>wait</p>');
		const { body } = render(Hole, { props: { q: 1, ogygiaFallback } });
		expect(body).toContain('endpoint="/__ogygia__?id=abc123"');
		expect(body).toContain('<p>wait</p>');
	});

	it('a lake in an island with a max age of zero writes it on its element', async () => {
		const Lake = await compiled(
			'lake',
			lake_wrapper_source('abc123', TINY, { maxAgeMs: 0 }, undefined)
		);
		const in_island = new Map([[Symbol.for('ogygia.nested-island'), true]]);
		const { body } = render(Lake, { props: { l: 1 }, context: in_island });
		expect(body).toContain('max-age="0"');
		expect(body).toContain('<b data-tiny="">tiny</b>');
	});
});
