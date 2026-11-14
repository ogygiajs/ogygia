/**
 * The snippet codec (region-snippet.ts) never imports a renderer, so plain Node can import it. A
 * bare snippet that must freeze where nothing installed the server's snippet renderer (no ogygia
 * hooks, no `region`, no Region.svelte loaded) says so with a code, instead of crossing as nothing.
 * This file imports none of them.
 */
import { expect, it } from 'vitest';
import type { Snippet } from 'svelte';
import { prepare_region_props, reduce_region_snippet } from '../src/region-snippet.ts';
import * as FreezeHost from './_fixtures/snippet-freeze/FreezeHost.svelte';

const { text } = FreezeHost as unknown as { text: Snippet };

it('a bare snippet encoded with no snippet renderer installed says snippet_freeze_not_installed', () => {
	expect(() => reduce_region_snippet(text)).toThrow(
		/snippet_freeze_not_installed|nothing that renders snippets/
	);
});

it('an island prop holding a bare snippet, with no renderer installed, names the prop', () => {
	expect(() => prepare_region_props({ children: text })).toThrow(/prop `children`/);
});
