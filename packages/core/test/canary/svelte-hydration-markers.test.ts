/**
 * CANARY (#1715): Svelte 5's SSR hydration markers, the comments its server render writes and its
 * client hydrate reads. They are Svelte's private format. ogygia's runtime reads them
 * (src/runtime/svelte-markers.ts, the one module that names them) to give a region its envelope, to
 * tell a parser-truncated region, and to take `<svelte:head>` blocks off the fragile hydrate walk.
 * Each fixture here is compiled by the installed Svelte and server-rendered.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import {
	ANCHOR,
	BLOCK_CLOSE,
	BLOCK_OPEN,
	FIRST_BRANCH_OPEN
} from '../../src/runtime/svelte-markers.ts';
import { broke, type Internal } from './upstream.ts';
import Branch from './_fixtures/Branch.svelte';
import List from './_fixtures/List.svelte';
import Keyed from './_fixtures/Keyed.svelte';
import Nested from './_fixtures/Nested.svelte';
import Empty from './_fixtures/Empty.svelte';
import Head from './_fixtures/Head.svelte';

const MARKERS: Internal = {
	upstream: "Svelte's SSR hydration comment markers",
	used_by: [
		'packages/core/src/runtime/svelte-markers.ts',
		'packages/core/src/runtime/hydrate-core.ts (the region envelope, neutralize_head_hydration_markers)',
		'packages/core/src/runtime/region-attrs.ts (region_ssr_truncated)',
		'packages/devtools/src/profiler/beacon.ts (the markers counted)'
	],
	issue: 1715
};

const comment = (data: string) => `<!--${data}-->`;
const OPEN = comment(BLOCK_OPEN);
const CLOSE = comment(BLOCK_CLOSE);

const body = (c: unknown, props: Record<string, unknown> = {}) =>
	render(c as Component<Record<string, unknown>>, { props }).body;

/** The comment data of every marker in `html`, in order. */
const markers = (html: string) => [...html.matchAll(/<!--([^]*?)-->/g)].map((m) => m[1]);

describe('the SSR hydration markers of the installed Svelte', () => {
	it("are Svelte's own constants", () => {
		const svelte = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
		const src = fs.readFileSync(path.join(svelte, 'src/constants.js'), 'utf8');
		const constant = (name: string) =>
			new RegExp(`export const ${name} = '([^']*)'`).exec(src)?.[1];
		expect(constant('HYDRATION_START'), broke(MARKERS, 'HYDRATION_START is not `[`')).toBe(
			BLOCK_OPEN
		);
		expect(constant('HYDRATION_END'), broke(MARKERS, 'HYDRATION_END is not `]`')).toBe(BLOCK_CLOSE);
		expect(
			constant('HYDRATION_START_ELSE')?.[0],
			broke(MARKERS, 'HYDRATION_START_ELSE does not start with `[`')
		).toBe(BLOCK_OPEN);
	});

	it('a component renders inside one block: `<!--[-->` … `<!--]-->`', () => {
		const html = body(Nested);
		expect(html.startsWith(OPEN), broke(MARKERS, `a render does not open with ${OPEN}`)).toBe(true);
		expect(html.endsWith(CLOSE), broke(MARKERS, `a render does not close with ${CLOSE}`)).toBe(
			true
		);
	});

	it("an {#if}'s first branch opens with `<!--[0-->`, any other branch with `[`", () => {
		const first = markers(body(Branch, { on: true }));
		expect(
			first[1],
			broke(MARKERS, `an {#if}'s first branch is not ${comment(FIRST_BRANCH_OPEN)}`)
		).toBe(FIRST_BRANCH_OPEN);
		const other = markers(body(Branch, { on: false }));
		expect(other[1][0], broke(MARKERS, "an {:else} branch's open does not start with `[`")).toBe(
			BLOCK_OPEN
		);
	});

	it('an {#each} and its fallback open with `[` and close with `]`', () => {
		for (const items of [['a', 'b'], []]) {
			const m = markers(body(List, { items }));
			expect(m[1][0], broke(MARKERS, "an {#each}'s open does not start with `[`")).toBe(BLOCK_OPEN);
			expect(m.at(-2), broke(MARKERS, "an {#each}'s close is not `]`")).toBe(BLOCK_CLOSE);
		}
	});

	it('a {#key} block and a {@render} write empty anchors `<!---->`', () => {
		expect(
			markers(body(Keyed, { k: 1 })),
			broke(MARKERS, 'a {#key} writes no `<!---->`')
		).toContain(ANCHOR);
		expect(markers(body(Empty)), broke(MARKERS, 'a {@render} writes no `<!---->`')).toContain(
			ANCHOR
		);
	});

	it('every block a page renders balances: as many `[` opens as `]` closes', () => {
		for (const html of [
			body(Branch, { on: true }),
			body(Branch, { on: false }),
			body(List, { items: ['a'] }),
			body(List, { items: [] }),
			body(Keyed, { k: 1 }),
			body(Nested),
			body(Empty)
		]) {
			const m = markers(html);
			const opens = m.filter((d) => d[0] === BLOCK_OPEN).length;
			const closes = m.filter((d) => d[0] === BLOCK_CLOSE).length;
			expect(opens, broke(MARKERS, `a render's opens and closes do not balance: ${html}`)).toBe(
				closes
			);
		}
	});

	it("a <svelte:head> block opens with its hash comment and an empty anchor at the head's top level", () => {
		const head = render(Head as Component).head;
		const m = markers(head);
		expect(m.length, broke(MARKERS, `a head block writes no markers: ${head}`)).toBeGreaterThan(1);
		const hash = m[0];
		expect(
			hash !== ANCHOR && hash[0] !== BLOCK_OPEN && hash[0] !== BLOCK_CLOSE,
			broke(MARKERS, `a head block does not open with a hash comment: ${head}`)
		).toBe(true);
		expect(
			m.slice(1),
			broke(MARKERS, `a head block has no empty anchor after its hash: ${head}`)
		).toContain(ANCHOR);
		expect(head, broke(MARKERS, 'the head content is not in the head')).toContain('name="canary"');
	});
});
