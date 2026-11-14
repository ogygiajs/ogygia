/**
 * The profiler's Islands table shows, per island, what the build counted in its code (handlers,
 * state, effects, binds, actions, files: `region_interactivity(entry)`). Region hands those counts
 * to the page's tail with the island's props, so its row carries them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import Region from '../src/Region.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import KitPagePass from './_fixtures/KitPagePass.svelte';
import { DocumentTail, set_tail_reader } from '../src/server/document-tail.ts';
import { set_island_interactivity } from './_stubs/server.region-deps.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';

const region = Region as unknown as Component<Record<string, unknown>>;
const kit_pass = KitPagePass as unknown as Component<Record<string, unknown>>;
const ENTRY = '/islands/tiny.js';
const COUNTS = { handlers: 2, state: 1, effects: 0, binds: 3, actions: 0, files: 4 };

function rows(props: Record<string, unknown>) {
	const tail = new DocumentTail();
	const event = { route: { id: '/counted' } };
	set_tail_reader(() => tail);
	set_request_event_stub(() => event);
	try {
		const children = (renderer: { push(html: string): void }) =>
			(region as unknown as (r: unknown, p: unknown) => void)(renderer, props);
		void render(kit_pass, { props: { children } }).body;
		tail.render(null, true);
		return tail.island_rows() ?? [];
	} finally {
		set_tail_reader(null);
		set_request_event_stub(null);
	}
}

afterEach(() => set_island_interactivity({}));

describe('an island row in the profiler', () => {
	it("carries the build's interactivity counts for the island's entry", () => {
		set_island_interactivity({ [ENTRY]: COUNTS });
		const list = rows({
			__mode: 'island',
			__entry: ENTRY,
			__component: Tiny,
			__props: { n: 1 },
			load: true
		});
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ entry: ENTRY, interactivity: COUNTS });
	});

	it('carries null when the build counted nothing for the entry', () => {
		const list = rows({
			__mode: 'island',
			__entry: ENTRY,
			__component: Tiny,
			__props: { n: 1 },
			load: true
		});
		expect(list[0]).toMatchObject({ entry: ENTRY, interactivity: null });
	});
});
