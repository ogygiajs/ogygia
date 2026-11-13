/**
 * The cross-island context bridge (~4.7 kB) is gated OUT of apps that never provide context. Two
 * halves guard that: the driver's reach of each file sets the `context` mark, and `resolveFeatures`
 * turns the mark into the bundled feature. The failure mode is silent (a missed provider drops
 * context inside islands at runtime), so this pins BOTH the include and — critically — the exclude.
 * The barrel and dynamic import forms: own-reach.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { context_keys } from '../src/compiler/link/context-detect.ts';
import { own_reach, reaches_context } from '../src/compiler/link/own-reach.ts';
import { resolveFeatures } from '../src/compiler/link/runtime-entry.ts';
import { dedent } from '@ogygia/core/contract';

const source_uses_ogygia_context = (src: string) =>
	reaches_context(own_reach(src, 'x.ts', 'script'));

describe('a provider is detected', () => {
	it.each([
		[`import { setContext } from 'ogygia';`, 'drop-in setContext'],
		[`import { Provide } from 'ogygia';`, 'Provide'],
		[`import { createContext } from 'ogygia';`, 'createContext'],
		[`import { setContext as sc } from 'ogygia';`, 'aliased'],
		[`import { Region, setContext, preload } from "ogygia";`, 'among other named imports, dq'],
		[
			dedent`
			import {
			  Provide,
			  createContext
			} from 'ogygia';
		`,
			'multi-line clause'
		],
		[
			`import type { X } from 'ogygia';\nimport { setContext } from 'ogygia';`,
			'after a type import'
		],
		[`import * as og from 'ogygia';\nog.setContext('k', v);`, 'namespace usage']
	])('detects %s (%s)', (src) => {
		expect(source_uses_ogygia_context(src)).toBe(true);
	});
});

describe('no provider, no bridge', () => {
	it.each([
		[`import { getContext } from 'ogygia';`, 'read-only getContext needs no bridge'],
		[`import { setContext } from 'svelte';`, "svelte's setContext is same-root, not a bridge"],
		[`import { Region } from 'ogygia';`, 'a non-context ogygia import'],
		[`const setContext = 1; // just a name`, 'the bare word without an ogygia import'],
		[`import * as og from 'ogygia';\nog.preload(x);`, 'namespace import, non-context member'],
		[`import type { setContext } from 'ogygia';`, 'a type-only import runs nothing'],
		['', 'empty file']
	])('ignores %s (%s)', (src) => {
		expect(source_uses_ogygia_context(src)).toBe(false);
	});
});

describe('context_keys — follows the getContext/setContext import binding, no text matching', () => {
	const reads = (src: string) => context_keys(src, 'script').reads;
	const sets = (src: string) => context_keys(src, 'script').sets;
	const svelteReads = (src: string) => context_keys(src, 'svelte').reads;

	it('counts a getContext read imported from svelte', () => {
		expect(
			reads(`import { getContext } from 'svelte';\nconst x = getContext('headingContext');`)
		).toEqual(['headingContext']);
	});

	it('counts a getContext read imported from ogygia', () => {
		expect(reads(`import { getContext } from 'ogygia';\ngetContext('theme');`)).toEqual(['theme']);
	});

	it('follows an alias (getContext as gc)', () => {
		expect(reads(`import { getContext as gc } from 'svelte';\ngc('cart');`)).toEqual(['cart']);
	});

	it('follows a namespace member (ns.getContext / ns.setContext)', () => {
		const src = dedent`
			import * as svelte from 'svelte';
			svelte.getContext('k');
			svelte.setContext('s', 1);
		`;
		expect(context_keys(src, 'script')).toEqual({ reads: ['k'], sets: ['s'], one_off: [] });
	});

	it('reads inside a Svelte component <script>', () => {
		const src = dedent`
			<script>
			  import { getContext } from 'svelte';
			  const first = getContext('headingContext')?.firstId;
			</script>
			<h1>{first}</h1>
		`;
		expect(svelteReads(src)).toEqual(['headingContext']);
	});

	it('separates a setContext (from svelte) into sets, not reads', () => {
		const src = dedent`
			import { setContext, getContext } from 'svelte';
			setContext('a', 1);
			getContext('b');
		`;
		expect(context_keys(src, 'script')).toEqual({ reads: ['b'], sets: ['a'], one_off: [] });
	});

	it('does NOT count a getContext that is not imported from svelte/ogygia', () => {
		expect(reads(`import { getContext } from './my-utils.js';\ngetContext('nope');`)).toEqual([]);
	});

	it('does NOT count a local function named getContext', () => {
		expect(reads(`function getContext(k) { return k; }\ngetContext('local');`)).toEqual([]);
	});

	it('does NOT count a method call on an unrelated object', () => {
		expect(reads(`import { getContext } from 'svelte';\nsomeApi.getContext('other');`)).toEqual([]);
	});

	it('does NOT count a dynamic (non-literal) key', () => {
		expect(reads(`import { getContext } from 'svelte';\ngetContext(keyVar);`)).toEqual([]);
	});

	it('does NOT count a key that is not a string (a number, a template)', () => {
		expect(reads(`import { getContext } from 'svelte';\ngetContext(1);`)).toEqual([]);
		expect(reads("import { getContext } from 'svelte';\ngetContext(`k`);")).toEqual([]);
	});

	it("follows an import named by a string ('getContext' as gc)", () => {
		expect(reads(`import { 'getContext' as gc } from 'svelte';\ngc('cart');`)).toEqual(['cart']);
		expect(sets(`import { 'setContext' as sc } from 'svelte';\nsc('cart', 1);`)).toEqual(['cart']);
	});

	it('ignores the word in a comment or string (no import → no parse-time binding)', () => {
		expect(reads(`// getContext('faux') in a comment\nconst s = "getContext('also')";`)).toEqual(
			[]
		);
		expect(sets(`// getContext('faux') in a comment\nconst s = "getContext('also')";`)).toEqual([]);
	});

	it('dedupes repeated reads of the same key', () => {
		expect(
			reads(dedent`
				import { getContext } from 'svelte';
				getContext('k');
				if (1) getContext('k');
			`)
		).toEqual(['k']);
	});

	it('unparseable source is a clean empty (no throw, no false warning)', () => {
		expect(
			context_keys(`import { getContext } from 'svelte';\nthis is not valid js (((`, 'script')
		).toEqual({ reads: [], sets: [], one_off: [] });
	});
});

describe('resolveFeatures — the mark gates the feature', () => {
	it('includes context only when the mark is set', () => {
		expect(resolveFeatures({ complete: true, hydrate: ['load'], context: true })).toContain(
			'context'
		);
		expect(resolveFeatures({ complete: true, hydrate: ['load'] })).not.toContain('context');
	});

	it('includes context under kitchen-sink (incomplete marks) — the safe default', () => {
		expect(resolveFeatures({ complete: false })).toContain('context');
	});
});
