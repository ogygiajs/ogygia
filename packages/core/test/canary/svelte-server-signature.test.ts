/**
 * CANARY (#1717): Svelte's compiled SERVER shapes that src/region-snippet.ts writes by hand, since
 * Svelte has no public way to render a snippet as a component: a server component is
 * `($$renderer, $$props) => void` whose body runs in `$$renderer.component(fn, Component)`, a server
 * snippet is `($$renderer, ...args)` with its arguments as plain values, and a renderer has `push`,
 * `child`, `head` and `global.mode`. Each is checked here
 * through the path ogygia uses, against snippets and components the installed Svelte compiles.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component, Snippet } from 'svelte';
import { og_portable } from '../../src/region-snippet.ts';
import { PORTABLE_FORM } from '../../src/portable-form.ts';
import { broke, type Internal } from './upstream.ts';
import * as SnippetHost from './_fixtures/SnippetHost.svelte';
import ArgEntry from './_fixtures/ArgEntry.svelte';
import Caller from './_fixtures/Caller.svelte';
import Lifter from './_fixtures/Lifter.svelte';

const SIGNATURE: Internal = {
	upstream: "Svelte's compiled server component and snippet signature (`$$renderer`)",
	used_by: ['packages/core/src/region-snippet.ts (RenderSnippet, the live server snippet)'],
	issue: 1717
};

type Renderer = {
	component?: unknown;
	push?: unknown;
	child?: unknown;
	head?: unknown;
	global?: { mode?: unknown };
};

/** What a hand-written server component sees of the renderer it is called with. */
function probe(): { seen: Renderer[]; Probe: Component } {
	const seen: Renderer[] = [];
	const Probe = ((r: Renderer) => {
		seen.push({
			component: typeof r.component,
			push: typeof r.push,
			child: typeof r.child,
			head: typeof r.head,
			global: { mode: r.global?.mode }
		});
	}) as unknown as Component;
	return { seen, Probe };
}

const portable = (snippet: unknown) =>
	(
		og_portable(snippet as Snippet, ArgEntry as Component, {}, '/entry.js') as unknown as Record<
			string,
			unknown
		>
	)[PORTABLE_FORM];

describe('the server shapes region-snippet.ts writes by hand', () => {
	it('a compiled snippet renders through a hand-written `($$renderer, $$props)` component', () => {
		const out: { frozen?: unknown } = {};
		void render(Lifter as Component<Record<string, unknown>>, {
			props: { snippet: (SnippetHost as unknown as { greeting: Snippet }).greeting, out }
		}).body;
		const frozen = out.frozen;
		expect(frozen, broke(SIGNATURE, 'a snippet no longer renders through RenderSnippet')).toEqual({
			m: 'static',
			h: expect.stringContaining('<b>hello</b>')
		});
	});

	it('a hand-written server snippet a compiled `{@render s(arg)}` calls gets its argument as a value', async () => {
		const sync = render(Caller as Component<{ s: unknown }>, { props: { s: portable(() => {}) } });
		expect(
			sync.body,
			broke(SIGNATURE, 'a server snippet is not called `($$renderer, value)`')
		).toContain('<i>raw</i>');
		const later = await render(Caller as Component<{ s: unknown }>, {
			props: { s: portable(() => {}) }
		});
		expect(later.body, broke(SIGNATURE, 'an async render does not take the snippet')).toContain(
			'<i>raw</i>'
		);
	});

	it("a renderer has `component`, `push`, `child`, `head` and its render's mode", async () => {
		const { seen, Probe } = probe();
		void render(Probe).body;
		await render(Probe);
		const [sync, later] = seen;
		for (const r of [sync, later])
			for (const key of ['component', 'push', 'child', 'head'] as const)
				expect(r[key], broke(SIGNATURE, `the renderer has no \`${key}()\``)).toBe('function');
		expect(
			sync.global?.mode,
			broke(SIGNATURE, "a sync render's renderer.global.mode is not 'sync'")
		).toBe('sync');
		expect(
			later.global?.mode,
			broke(SIGNATURE, "an awaited render's renderer.global.mode is not 'async'")
		).toBe('async');
	});
});
