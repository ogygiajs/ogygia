import { expect, test } from 'vitest';
import type { Snippet } from 'svelte';
import { SnippetRender } from '../src/snippet-render.ts';
import * as fixture from './fixtures/FrozenSnippet.svelte';
import { FROZEN_RICH } from './_frozen-snippet.ts';

const { rich_snippet } = fixture as unknown as { rich_snippet: () => Snippet };

test('the server freezes a snippet to the HTML the browser freezes it to', () => {
	expect(new SnippetRender().freeze(rich_snippet())).toBe(FROZEN_RICH);
});
