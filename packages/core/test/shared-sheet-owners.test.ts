/**
 * A SHEET NAMES EVERY OUTERMOST ISLAND THAT USES IT (#854). A region sheet is claimed once per
 * request, so its tag names only the first island that wrote it (`data-og-owner`). The page's tail
 * lists the other owners (`<script type="application/json" data-og-owners>`, sheet identity → their
 * fingerprints): a navigation that keeps any of them keeps the sheet
 * (test/browser/shared-sheet-owners.test.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import Region from '../src/Region.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import KitPagePass from './_fixtures/KitPagePass.svelte';
import { DocumentTail, set_tail_reader } from '../src/server/document-tail.ts';
import { set_island_css } from './_stubs/server.region-deps.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';

const region = Region as unknown as Component<Record<string, unknown>>;
const kit_pass = KitPagePass as unknown as Component<Record<string, unknown>>;
const ENTRY = '/islands/tiny.js';
const SHARED = '/islands/shared.css';

const island = (props: Record<string, unknown>) => ({
	__mode: 'island',
	__entry: ENTRY,
	__component: Tiny,
	__props: props,
	load: true
});

/** One page render in Kit's page pass, with its tail: the head, the body, and the tail's HTML. */
function page(list: Array<Record<string, unknown>>) {
	const tail = new DocumentTail();
	const event = { route: { id: '/shared' } };
	set_tail_reader(() => tail);
	set_request_event_stub(() => event);
	try {
		const children = (renderer: { push(html: string): void }) => {
			for (const props of list)
				(region as unknown as (r: unknown, p: unknown) => void)(renderer, props);
		};
		const out = render(kit_pass, { props: { children } });
		return { head: out.head, body: out.body, tail: tail.render() };
	} finally {
		set_tail_reader(null);
		set_request_event_stub(null);
	}
}

const fps = (body: string) => [...body.matchAll(/data-og-fp="([^"]+)"/g)].map((m) => m[1]!);
const owners = (tail: string): Record<string, string[]> | null => {
	const m = /<script type="application\/json" data-og-owners>([^<]*)<\/script>/.exec(tail);
	return m ? JSON.parse(m[1]!) : null;
};

afterEach(() => set_island_css({}));

describe('shared region sheets: every owner', () => {
	it('a sheet two outer islands share: the tag names the first, the tail lists the second', () => {
		set_island_css({ [ENTRY]: [SHARED] });
		const out = page([island({ n: 1 }), island({ n: 2 })]);
		const [first, second] = fps(out.body);
		expect(first).toBeTruthy();
		expect(second).toBeTruthy();
		expect(first).not.toBe(second);
		// one tag, as before
		expect(out.head.match(/data-ogygia-region-css/g)?.length).toBe(1);
		expect(out.head).toContain(`data-og-owner="${first}"`);
		expect(owners(out.tail)).toEqual({ [SHARED]: [second] });
	});

	it('twins (one fingerprint) and a sheet with one owner list nothing', () => {
		set_island_css({ [ENTRY]: [SHARED] });
		const out = page([island({ n: 1 }), island({ n: 1 })]);
		expect(owners(out.tail)).toBeNull();
	});
});
