import { expect, test } from 'vitest';
import type { Snippet } from 'svelte';
import { SnippetRender } from '../src/snippet-render.ts';
import * as fixture from './fixtures/FrozenSnippet.svelte';
import { FROZEN_RICH } from './_frozen-snippet.ts';

const { rich } = fixture as unknown as { rich: Snippet };

test('the server freezes a snippet to the HTML the browser freezes it to', () => {
	expect(new SnippetRender().freeze(rich)).toBe(FROZEN_RICH);
});
