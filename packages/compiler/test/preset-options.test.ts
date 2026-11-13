// A preset's options, read into the region's identity (the key its id and cache are made from) or
// refused by name. Covers the live hole's `revalidate` / `maxAge` (ms) / `onExpire`, the deferred
// hole's `maxAge` (seconds, an HTTP max-age), `stitch`, and the keys a preset may and may not hold.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import { transformHost, wrapperVirtualId } from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type Ctx = Parameters<typeof transformHost>[2];
type Preset = Record<string, unknown>;

function ctx(presets: Record<string, Preset>): Ctx {
	return {
		...HOST_CTX_DEFAULTS,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_host: string, iid: string) => wrapperVirtualId(iid),
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets,
		pathModule: path
	} as Ctx;
}

const HOST = '/app/src/routes/+page.svelte';
const SRC = dedent`
	<script>
	import C from './C.svelte' with { preset: 'p' };
	</script>
	<C />
`;

/** The region's identity past the component path, e.g. `lake:swr:when:load`. */
function identity_of(preset: Preset, presets: Record<string, Preset> = { p: preset }): string {
	const out = transformHost(SRC, HOST, ctx(presets))!;
	expect(out.islands).toHaveLength(1);
	return String(out.islands[0].identity).split('\u0000')[1];
}
function refusal_of(preset: Preset, presets: Record<string, Preset> = { p: preset }): string {
	try {
		transformHost(SRC, HOST, ctx(presets));
	} catch (e) {
		return (e as Error).message;
	}
	throw new Error('expected a build error');
}

describe('a live preset: remount from revalidate, maxAge (ms) and onExpire', () => {
	it.each([
		[{}, 'lake:swr:when:load'],
		[{ revalidate: 'idle' }, 'lake:swr:when:idle'],
		[{ revalidate: false }, 'lake:cache'],
		[{ revalidate: false, maxAge: 10, onExpire: 'empty' }, 'lake:cache:maxAge:10:onExpire:empty'],
		[{ maxAge: 1500, onExpire: 'fetch' }, 'lake:swr:when:load:maxAge:1500:onExpire:fetch'],
		[{ wake: 'visible' }, 'lake:swr:when:visible:margin:0px']
	])('%j → %s', (opts, want) => {
		expect(identity_of({ render: 'live', ...opts })).toBe(want);
	});

	it.each([
		[1500.9, 1500],
		[0, 0],
		['10', 10],
		['500ms', 500],
		['30s', 30_000],
		['1.5s', 1500],
		[' 2S ', 2000],
		['5m', 300_000],
		['1h', 3_600_000]
	])('maxAge %j is %d ms', (maxAge, ms) => {
		expect(identity_of({ render: 'live', maxAge })).toBe(`lake:swr:when:load:maxAge:${ms}`);
	});

	it.each([
		[{ maxAge: -1 }, /maxAge` must be a non-negative number \(ms\), got -1/],
		[{ maxAge: Infinity }, /non-negative number \(ms\), got Infinity/],
		[{ maxAge: 'soon' }, /unknown remount\.maxAge 'soon'/],
		[{ maxAge: '5d' }, /unknown remount\.maxAge '5d'/],
		[{ maxAge: true }, /maxAge` must be a number \(ms\) or duration string/],
		[{ revalidate: true }, /revalidate: true` is invalid/],
		[{ revalidate: 'sometimes' }, /unknown remount\.revalidate 'sometimes'/],
		[{ onExpire: 'later' }, /unknown remount\.onExpire 'later'/],
		[{ revalidate: false, onExpire: 'fetch' }, /onExpire: 'fetch'` requires `revalidate`/]
	])('%j is refused', (opts, re) => {
		expect(refusal_of({ render: 'live', ...opts })).toMatch(re);
	});
});

describe('a deferred preset: maxAge is an HTTP max-age in seconds', () => {
	it.each([
		[30, 'defer:load:ttl:30'],
		['30', 'defer:load:ttl:30'],
		['5m', 'defer:load:ttl:300'],
		['1h', 'defer:load:ttl:3600'],
		['1500ms', 'defer:load:ttl:1'],
		['500ms', 'defer:load'],
		[0, 'defer:load']
	])('maxAge %j → %s', (maxAge, want) => {
		expect(identity_of({ render: 'deferred', maxAge })).toBe(want);
	});

	it.each([
		[-1, /maxAge` must be a non-negative number of seconds, got -1/],
		['soon', /unknown `maxAge` 'soon'/],
		[false, /maxAge` must be a number of seconds or a duration string/]
	])('maxAge %j is refused', (maxAge, re) => {
		expect(refusal_of({ render: 'deferred', maxAge })).toMatch(re);
	});
});

describe('preset keys', () => {
	it.each([
		[{ render: 'deferred', stitch: true }, 'defer:load:stitch:serve'],
		[{ render: 'deferred', stitch: 'serve' }, 'defer:load:stitch:serve'],
		[{ render: 'deferred', stitch: 'edge' }, 'defer:load:stitch:edge'],
		[{ render: 'deferred', fetch: 'visible', margin: '20px' }, 'defer:visible:margin:20px'],
		[
			{ render: 'deferred', fetch: 'interaction', prefetch: 'idle' },
			'defer:interaction:prefetch:idle'
		],
		[{ wake: 'visible', margin: '30px' }, 'hydrate:visible:margin:30px'],
		[{ wake: 'load', keep: 'player' }, 'hydrate:load:keep:player'],
		[{ wake: 'load', margin: null, maxAge: undefined }, 'hydrate:load']
	])('%j → %s', (preset, want) => {
		expect(identity_of(preset)).toBe(want);
	});

	it.each([
		[{ render: 'deferred', stitch: 'cdn' }, /`stitch` takes `true` \/ 'serve'/],
		[{ render: 'deferred', stitch: false }, /`stitch` takes `true` \/ 'serve'/],
		[{ wake: 'load', color: 'red' }, /unknown key `color` in preset 'p'/],
		[{ margin: '10px' }, /preset 'p' must set `render` or `wake`/],
		[{ wake: 'load', stitch: 'serve' }, /`stitch` is only valid with `render: 'deferred'`/]
	])('%j is refused', (preset, re) => {
		expect(refusal_of(preset)).toMatch(re);
	});

	it('an unknown preset names the ones there are, or says there are none', () => {
		expect(refusal_of({}, { a: { wake: 'load' }, b: { wake: 'idle' } })).toMatch(
			/unknown preset 'p'\. Available: a, b\./
		);
		expect(refusal_of({}, {})).toMatch(/unknown preset 'p'\. Available: \(none\)\./);
	});
});
