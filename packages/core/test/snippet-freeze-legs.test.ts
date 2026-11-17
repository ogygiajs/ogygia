import { expect, test } from 'vitest';
import { SnippetRender } from '../src/snippet-render.ts';
import { rich } from './fixtures/FrozenSnippet.svelte';
import { FROZEN_RICH } from './_frozen-snippet.ts';

test('the server freezes a snippet to the HTML the browser freezes it to', () => {
	expect(new SnippetRender().freeze(rich)).toBe(FROZEN_RICH);
});
