import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import RegionUnder from './_fixtures/RegionUnder.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import { page } from './_stubs/app-state.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import { set_page_recorder } from '../src/page-seed-registry.ts';
import type { RegionSettings } from '../src/region-plan.ts';

type Props = Record<string, unknown>;
const under = RegionUnder as unknown as Component<{ regions: Props[] }>;
const ISLAND: RegionSettings = {
	mode: 'island',
	entry: '/islands/tiny.js',
	component: Tiny as never
};
const KEPT = { data: page.data, form: page.form, error: page.error, status: page.status };

afterEach(() => {
	Object.assign(page, KEPT);
	set_page_recorder(null);
	set_request_event_stub(null);
});

describe("a region on the server hands the page seed Kit's page as it is", () => {
	it('its data, form, error and status reach the recorder', () => {
		const error = new Error('not found');
		Object.assign(page, { data: { title: 'x' }, form: { sent: true }, error, status: 404 });
		const seen: unknown[] = [];
		set_page_recorder((snapshot) => seen.push(snapshot));
		set_request_event_stub(() => ({ route: { id: '/page' } }));
		void render(under, { props: { regions: [{ __og: ISLAND, __props: {} }] } }).body;
		expect(seen).toEqual([{ data: { title: 'x' }, form: { sent: true }, error, status: 404 }]);
	});
});
