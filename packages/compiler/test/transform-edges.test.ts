// Edges of the region transform the mutation pass found unpinned: which ids are ogygia's own glue,
// the `.ts` asRegion option reader (configured names and their defaults), and what a
// `render: 'live'` region may carry (only what the revalidate endpoint can serialize).
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import {
	is_island_path,
	transformHost,
	transformTsRegions,
	wrapperVirtualId
} from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type Ctx = Parameters<typeof transformHost>[2];
function ctx(importKeys?: Record<string, string>): Ctx {
	return {
		...HOST_CTX_DEFAULTS,
		importKeys,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_host: string, iid: string) => wrapperVirtualId(iid),
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {},
		pathModule: path
	} as Ctx;
}

describe('is_island_path: ogygia glue ids, by family and extension', () => {
	it.each([
		['ogygia:region/entry/a.js', true],
		['ogygia:region/entry/a.svelte', true],
		['ogygia:region/entry/a.js?v=1', true],
		['ogygia:region/entry/a.ts', false],
		['ogygia:region/wrapper/a.svelte', true],
		['ogygia:region/wrapper/a.js', false],
		['ogygia:region/binding/a.js', true],
		['ogygia:region/binding/a.svelte', false],
		['ogygia:region/lazy/a.js', true],
		['ogygia:region/lazy/a.svelte', false],
		['/app/.ogygia/a.svelte', true],
		['/app/.ogygia/a.js', false],
		['/app/src/entry/a.js', false],
		['/app/src/A.svelte', false]
	])('%s → %s', (id, want) => {
		expect(is_island_path(id)).toBe(want);
	});
});

describe('asRegion in a .ts module: the option reader', () => {
	const compile = (opts: string, keys?: Record<string, string>) => {
		const src = dedent`
			import { H } from '$lib/H.svelte';
			const X = import.meta.og.asRegion(H, ${opts});
			export { X };
		`;
		try {
			const out = transformTsRegions(src, '/app/src/lib/r.ts', ctx(keys));
			return String(out!.islands[0].identity).split('\u0000')[1];
		} catch (e) {
			return `refused: ${(e as Error).message.split('\n')[0]}`;
		}
	};

	it.each([
		[`{ wake: 'load' }`, undefined, 'region:load'],
		[`{ 'wake': 'load' }`, undefined, 'region:load'],
		[`{ region: 'raw' }`, undefined, 'region:raw'],
		[`{ render: 'deferred', fetch: 'idle' }`, undefined, 'defer:idle'],
		// a configured name, and the default name beside it, both read
		[`{ hydrate: 'load' }`, { wake: 'hydrate' }, 'region:load'],
		[`{ wake: 'load' }`, { wake: 'hydrate' }, 'region:load'],
		[`{ held: 'raw' }`, { region: 'held' }, 'region:raw'],
		[`{ region: 'raw' }`, { region: 'held' }, 'region:raw'],
		[`{ show: 'deferred', when: 'idle' }`, { render: 'show', fetch: 'when' }, 'defer:idle'],
		[`{ render: 'deferred', fetch: 'idle' }`, { render: 'show', fetch: 'when' }, 'defer:idle']
	])('%s with keys %j → %s', (opts, keys, want) => {
		expect(compile(opts, keys)).toBe(want);
	});

	it.each([
		[`{ ['wake']: 'load' }`, /options must be a plain object of string-valued keys/],
		[`{ ...o }`, /options must be a plain object of string-valued keys/],
		[`{ wake: 1 }`, /option `wake` must be a string literal/],
		['{ wake: `load` }', /option `wake` must be a string literal/],
		[`{ color: 'red' }`, /unknown option `color`/],
		[`{ render: 'deferred', region: 'raw' }`, /`render` and `region` are different markers/],
		[`'load'`, /needs an options object/]
	])('%s is refused', (opts, re) => {
		expect(compile(opts)).toMatch(re);
	});

	it.each([
		`const X = og.asRegion(H, { wake: 'load' });`,
		`const X = window.og.asRegion(H, { wake: 'load' });`,
		`const X = import.meta.env.asRegion(H, { wake: 'load' });`,
		`const X = import.meta.og.region(H, { wake: 'load' });`,
		`const X = import.meta.og['asRegion'](H, { wake: 'load' });`
	])('only import.meta.og.asRegion is the macro: %s', (line) => {
		const src = dedent`
			import { H } from '$lib/H.svelte';
			${line}
			export { X };
		`;
		const out = transformTsRegions(src, '/app/src/lib/r.ts', ctx());
		expect(out?.islands ?? []).toEqual([]);
	});
});

describe("render: 'live' carries only what the revalidate endpoint can serialize", () => {
	const place = (tag: string) => {
		const src = dedent`
			<script>
			import L from './L.svelte' with { render: 'live' };
			let { ...rest } = $props();
			let v = $state(1);
			</script>
			${tag}
		`;
		try {
			transformHost(src, '/app/src/routes/+page.svelte', ctx());
			return 'ok';
		} catch (e) {
			return (e as Error).message.split('\n')[0];
		}
	};

	it.each([
		'<L />',
		'<L title="x" n={1} />',
		'<L {...rest} />',
		'<L online={true} hidden />',
		'<L label="a {v} b" />',
		'<L>\n\t\n</L>'
	])('%s is allowed', (tag) => {
		expect(place(tag)).toBe('ok');
	});

	it.each([
		['<L>x</L>', /cannot have children/],
		['<L bind:value={v} />', /cannot use `bind:value`/],
		['<L onclick={() => v++} />', /cannot use `onclick`/],
		['<L onpointerdown={rest.f} />', /cannot use `onpointerdown`/],
		['<L render={() => v} />', /cannot use a function value for `render`/],
		['<L render={function () { return v; }} />', /cannot use a function value for `render`/],
		['<L {@attach rest.a} />', /cannot use `AttachTag`/]
	])('%s is refused', (tag, re) => {
		expect(place(tag)).toMatch(re);
	});

	it.each([
		[`{ render: 'live', revalidate: 'visible' }`, 'lake:swr:when:visible:margin:50px'],
		[
			`{ render: 'live', revalidate: 'visible', margin: '9px' }`,
			'lake:swr:when:visible:margin:9px'
		],
		[`{ render: 'live', revalidate: 'idle', margin: '9px' }`, 'lake:swr:when:idle']
	])('a live preset %s revalidating on visible takes a margin: %s', (preset, want) => {
		const src = dedent`
			<script>
			import L from './L.svelte' with { preset: 'p' };
			</script>
			<L />
		`;
		const c = {
			...ctx(),
			visibleMargin: '50px',
			presets: { p: new Function(`return ${preset}`)() }
		} as Ctx;
		const out = transformHost(src, '/app/src/routes/+page.svelte', c)!;
		expect(String(out.islands[0].identity).split('\u0000')[1]).toBe(want);
	});
});

describe('inline stitch on a hole', () => {
	it.each([
		['serve', 'defer:load:stitch:serve'],
		['edge', 'defer:load:stitch:edge']
	])("stitch: '%s' → %s", (mode, want) => {
		const src = dedent`
			<script>
			import D from './D.svelte' with { render: 'deferred', stitch: '${mode}' };
			</script>
			<D />
		`;
		const out = transformHost(src, '/app/src/routes/+page.svelte', ctx())!;
		expect(String(out.islands[0].identity).split('\u0000')[1]).toBe(want);
	});
});

describe('a portable snippet that captures a host store', () => {
	const compile = (decl: string, use: string) => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const src = dedent`
				<script>
				import Widget from './Widget.svelte' with { wake: 'load' };
				import { writable, derived } from 'svelte/store';
				${decl}
				</script>

				<Widget>
					{#snippet children()}
						${use}
					{/snippet}
				</Widget>
			`;
			transformHost(src, `/app/src/routes/s${Math.random()}/+page.svelte`, {
				...ctx(),
				ssr: true
			} as Ctx);
			return warn.mock.calls.flat().join('\n');
		} finally {
			warn.mockRestore();
		}
	};

	it.each([
		['const s = writable(0);', '<b>{s}</b>'],
		['const s = derived(other, (x) => x);', '<b>{s}</b>'],
		['const s = make();', '<b>{s}{$s}</b>']
	])('`%s` used as %s warns that the object cannot cross', (decl, use) => {
		expect(compile(decl, use)).toMatch(/captures the store\s+`s` as an OBJECT/);
	});

	it.each([
		['const s = make();', '<b>{s}</b>'],
		['let s = $state(0);', '<b>{s}</b>'],
		['const slots = {}; const all = $$slots;', '<b>{slots.a}</b>'],
		['const [s] = [writable(0)];', '<b>{s}</b>']
	])('`%s` used as %s does not', (decl, use) => {
		expect(compile(decl, use)).not.toMatch(/as an OBJECT/);
	});

	it('the frozen-snapshot warning points at the line and column of each $store read', () => {
		const said = compile('const s = writable(0);', '<b>{$s}</b>');
		expect(said).toMatch(/FROZEN/);
		// line 9 is `\t\t<b>{$s}</b>`: the read starts at column 7
		expect(said).toMatch(/\+page\.svelte:9:7\b/);
	});
});
