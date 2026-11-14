// What a template subtree reads from outside it (`collectFreeIdentifiers`): a portable snippet's entry
// re-imports or captures exactly these names, so a missed one is a ReferenceError at render and
// an extra one is a host value serialized for nothing. Then the same, end to end through the host
// transform: the snippet's entry declares every name its markup uses.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parse } from 'svelte/compiler';
import { dedent } from '@ogygia/core/contract';
import { collectFreeIdentifiers } from '../src/free-vars.ts';
import { transformHost } from '../src/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

const free = (markup: string) =>
	[...collectFreeIdentifiers(parse(markup, { modern: true }).fragment.nodes as never)].sort();

describe('collectFreeIdentifiers', () => {
	it.each([
		['<p use:act>x</p>', ['act']],
		['<p use:act={arg}>x</p>', ['act', 'arg']],
		['<p use:lib.act>x</p>', ['lib']],
		['<p transition:fade>x</p>', ['fade']],
		['<p in:fly={{ y }} out:fade>x</p>', ['fade', 'fly', 'y']],
		['{#each xs as x (x)}<p animate:flip>{x}</p>{/each}', ['flip', 'xs']],
		['<p style:color>x</p>', ['color']],
		['<p style:color={c}>x</p>', ['c']],
		['<p style:color="red">x</p>', []],
		['<p class:active>x</p>', ['active']],
		['<svelte:component this={Comp} n={1} />', ['Comp']],
		['{#each xs as x}<p use:act={x}>x</p>{/each}', ['act', 'xs']],
		['{(() => { for (const q of qs) q; return q; })()}', ['q', 'qs']],
		['{(() => { for (let i = 0; i < n; i++); return i; })()}', ['i', 'n']],
		['{(() => { for (const k in o) k; return k; })()}', ['k', 'o']],
		['{class { m() { return t; } }}', ['t']],
		['{(() => { class K {} return K; })()}', []]
	])('%s → %j', (markup, want) => {
		expect(free(markup)).toEqual(want);
	});
});

describe('a portable snippet entry declares every name its markup reads from the host', () => {
	const synth_of = (decl: string, body: string) => {
		const src = dedent`
			<script>
			import Widget from './Widget.svelte' with { wake: 'load' };
			${decl}
			</script>
			<Widget>
				{#snippet children()}
					${body}
				{/snippet}
			</Widget>
		`;
		const out = transformHost(src, '/app/src/routes/x/+page.svelte', {
			...HOST_CTX_DEFAULTS,
			ssr: true,
			root: '/app',
			libDir: '/app/src/lib',
			readFile: () => null,
			dev: false,
			virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
			devUrlFor: (p: string) => p,
			visibleMargin: '0px',
			presets: {},
			pathModule: path
		} as Parameters<typeof transformHost>[2])!;
		return out.islands.map((i) => i.source ?? '').find((s) => s.includes('<script')) ?? '';
	};

	it.each([
		[
			`import { fade } from 'svelte/transition';`,
			'<p transition:fade>x</p>',
			/import \{ fade \} from 'svelte\/transition'/
		],
		[`import { act } from './act.ts';`, '<p use:act>x</p>', /import \{ act \} from '\.\/act\.ts'/],
		[`let color = 'red';`, '<p style:color>x</p>', /let \{ color \} = \$props\(\)/],
		[
			`import Comp from './Comp.svelte';`,
			'<svelte:component this={Comp} />',
			/import Comp from '\.\/Comp\.svelte'/
		]
	])('%s used as %s', (decl, body, want) => {
		expect(synth_of(decl, body)).toMatch(want);
	});
});
