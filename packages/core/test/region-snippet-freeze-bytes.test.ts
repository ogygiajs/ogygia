/**
 * The HTML a bare snippet freezes to (`region.snippet(snippet)`, and every bare snippet an island's
 * props carry across), byte for byte: it is what the page body and the island's props carry, and
 * the snippet's stable id hashes it, so a change here changes every page with a frozen snippet.
 */
import { expect, it } from 'vitest';
import type { Snippet } from 'svelte';
import { region } from '../src/region.ts';
import * as FreezeHost from './_fixtures/snippet-freeze/FreezeHost.svelte';

const SNIPPETS = FreezeHost as unknown as Record<string, Snippet>;
const frozen = (name: string) =>
	(region.snippet(SNIPPETS[name]!) as { __ogRegion?: unknown }).__ogRegion;

it.each([
	'text',
	'elements',
	'blocks',
	'nested',
	'component',
	'odd',
	'one_param',
	'two_params',
	'null_default'
])('a frozen `%s` snippet has the same bytes as before', (name) => {
	expect(frozen(name)).toMatchSnapshot();
});
