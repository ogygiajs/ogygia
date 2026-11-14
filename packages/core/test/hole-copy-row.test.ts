/**
 * The profiler's hole table counts each copy of a hole (one hole, other props) by its copy key:
 * the key of the endpoint's `props=` payload, the one the browser's report and the hole's requests
 * name it by. Region hands that key to the page's tail for every hole it renders.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import Region from '../src/Region.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import KitPagePass from './_fixtures/KitPagePass.svelte';
import { DocumentTail, set_tail_reader } from '../src/server/document-tail.ts';
import { hole_copy_of } from '../src/contract/hash.ts';
import { set_region_endpoints } from './_stubs/server.region-endpoint.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';

const region = Region as unknown as Component<Record<string, unknown>>;
const kit_pass = KitPagePass as unknown as Component<Record<string, unknown>>;
const endpoint = (entry: string, props: unknown) =>
	`/__ogygia__?id=${entry}&props=${Buffer.from(JSON.stringify(props)).toString('base64url')}`;

function holes(list: Array<Record<string, unknown>>) {
	const tail = new DocumentTail();
	const event = { route: { id: '/copies' } };
	set_tail_reader(() => tail);
	set_request_event_stub(() => event);
	set_region_endpoints({ mint_server_region: (entry, props) => endpoint(entry, props) });
	try {
		const children = (renderer: { push(html: string): void }) => {
			for (const props of list)
				(region as unknown as (r: unknown, p: unknown) => void)(renderer, props);
		};
		void render(kit_pass, { props: { children } }).body;
		return tail.hole_rows();
	} finally {
		set_tail_reader(null);
		set_request_event_stub(null);
		set_region_endpoints(null);
	}
}

const hole = (props: Record<string, unknown>) => ({
	__mode: 'server',
	__entry: 'hole-a',
	__component: Tiny,
	__props: props,
	__defer: 'load'
});

afterEach(() => set_region_endpoints(null));

describe("a hole's row in the profiler", () => {
	it('names each copy by the key of its endpoint’s props', () => {
		const rows = holes([hole({ q: 1 }), hole({ q: 2 }), hole({ q: 1 })]);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.count).toBe(3);
		const want = [
			hole_copy_of(endpoint('hole-a', { q: 1 })),
			hole_copy_of(endpoint('hole-a', { q: 2 }))
		];
		expect(want.every(Boolean)).toBe(true);
		expect(rows[0]!.copies?.map((c) => c.p)).toEqual(want);
	});
});
