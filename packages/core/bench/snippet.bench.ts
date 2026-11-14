// Freezing bare snippets at an island boundary: each one rendered once on the server to the HTML
// that crosses (RenderSnippet.svelte through `render()`). Per island, with the snippets a CMS block
// hands its island: text, elements, blocks, nested renders and a child component.
import { bench } from '@bench/heisenbench/bench';
import type { Snippet } from 'svelte';
import { prepare_region_props } from '../src/region-snippet.ts';
import * as FreezeHost from '../test/_fixtures/snippet-freeze/FreezeHost.svelte';

const SNIPPETS = FreezeHost as unknown as Record<string, Snippet>;
const NAMES = ['text', 'elements', 'blocks', 'nested', 'component', 'odd', 'one_param'];

bench(
	'snippet freeze: an island handed seven bare snippets',
	({ props }) => prepare_region_props(props),
	{
		setup: () => ({ props: Object.fromEntries(NAMES.map((n) => [n, SNIPPETS[n]])) }),
		scale: (_, k) => ({
			props: Object.fromEntries(
				Array.from({ length: 7 * k }, (_, i) => [`s${i}`, SNIPPETS[NAMES[i % NAMES.length]!]])
			)
		})
	}
);
