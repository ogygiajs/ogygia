/**
 * `region.snippet(snippet)` freezes a snippet to HTML by rendering it once on the server. Svelte's
 * dev build checks each element a snippet writes against the component it runs in, and the
 * hand-written component that renders the snippet set none: in dev, freezing any snippet that
 * writes an element threw ("reading 'Symbol(filename)'"), and the island never rendered.
 */
import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component, Snippet } from 'svelte';
import * as SnippetHost from './canary/_fixtures/SnippetHost.svelte';
import Lifter from './canary/_fixtures/Lifter.svelte';

it('region.snippet() freezes a compiled snippet that writes elements, in a dev build', () => {
	const { greeting } = SnippetHost as unknown as { greeting: Snippet };
	const out: { frozen?: unknown } = {};
	void render(Lifter as Component<Record<string, unknown>>, { props: { snippet: greeting, out } })
		.body;
	expect(out.frozen).toEqual({ m: 'static', h: expect.stringContaining('<b>hello</b>') });
});
