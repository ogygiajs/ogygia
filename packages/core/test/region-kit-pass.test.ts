import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { setContext, type Component } from 'svelte';
import RegionUnder from './_fixtures/RegionUnder.svelte';
import KitEventBelow from './_fixtures/KitEventBelow.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import RegionC from '../src/Region.svelte';
import { REGION_BRAND } from '../src/region.ts';
import { DocumentTail, set_tail_reader } from '../src/server/document-tail.ts';
import { KIT_REQUEST_CONTEXT } from '../src/server/kit-context.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import { set_entry_locations } from './_stubs/server.region-deps.ts';
import type { RegionSettings } from '../src/region-plan.ts';

type Props = Record<string, unknown>;
const under = RegionUnder as unknown as Component<{ setup?: () => void; regions: Props[] }>;
const region = RegionC as unknown as (renderer: unknown, props: Props) => void;
const ENTRY = '/islands/tiny.js';
const ISLAND: RegionSettings = { mode: 'island', entry: ENTRY, component: Tiny as never };
const PROPS_SCRIPT = '<script type="application/ogygia-props"';

let tail: DocumentTail;
beforeEach(() => {
	tail = new DocumentTail();
	const t = tail;
	set_tail_reader(() => t);
	const event = { route: { id: '/page' } };
	set_request_event_stub(() => event);
});
afterEach(() => {
	set_tail_reader(null);
	set_request_event_stub(null);
	set_entry_locations({});
});

function on_kit_pass(regions: Props[]): string {
	const setup = () => setContext(KIT_REQUEST_CONTEXT, { page: {} });
	return render(under, { props: { setup, regions } }).body;
}

describe("a region on Kit's page pass", () => {
	it('marks the pass, so an island below a request context with an event still hands its props to the tail', () => {
		const held = {
			[REGION_BRAND]: true,
			kind: 'inline',
			component: KitEventBelow,
			props: {}
		};
		const island_below = (r: unknown) => region(r, { __og: ISLAND, __props: { n: 1 } });
		const body = on_kit_pass([{ of: held, children: island_below }]);
		expect(body).toContain(`<ogygia-region entry="${ENTRY}"`);
		expect(body).not.toContain(PROPS_SCRIPT);
		expect(tail.render()).toContain(PROPS_SCRIPT);
	});

	it("an island whose entry has no built location records its module url in the tail's island row", () => {
		on_kit_pass([{ __og: ISLAND, __props: { n: 1 } }]);
		tail.render(null, true);
		expect(tail.island_rows()?.map((r) => r.module_url)).toEqual([ENTRY]);
	});

	it("an island whose entry has a built location records that location in the tail's island row", () => {
		set_entry_locations({ [ENTRY]: '/_app/immutable/tiny.hashed.js' });
		on_kit_pass([{ __og: ISLAND, __props: { n: 1 } }]);
		tail.render(null, true);
		expect(tail.island_rows()?.map((r) => r.module_url)).toEqual([
			'/_app/immutable/tiny.hashed.js'
		]);
	});
});
