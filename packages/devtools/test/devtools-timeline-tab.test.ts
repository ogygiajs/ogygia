// The Timeline tab draws this page's client events: one lane per region (and one for the page and
// its navigations), a bar from a region's first schedule to its hydration.
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;

const { ingest, clear, configure } = await import('@ogygia/core/events');
const { default: TimelineTab } = await import('../src/devtools/TimelineTab.svelte');
import type { DevtoolsEvent } from '@ogygia/core/events';
import { record_hook } from '../src/devtools/hook-record.ts';

const RECORD = Symbol.for('ogygia.hook-record');

let seq = 0;
const ev = (name: string, t: number, more: Record<string, unknown> = {}) =>
	({
		domain: 'runtime',
		name,
		v: 1,
		seq: seq++,
		t,
		realm: 'client',
		...more
	}) as unknown as DevtoolsEvent;

/** The tab's lanes, by their title (a region's fingerprint, or `page`). */
function lanes(html: string): string[] {
	return [...html.matchAll(/<div class="label\b[^"]*"[^>]*title="([^"]+)"/g)].map((m) => m[1]);
}
const html = () => render(TimelineTab, { props: { tick: 0 } }).body;

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[RECORD];
	clear();
	configure({ active: true, cap: 4096 });
});

describe('the Timeline tab', () => {
	it("draws the client's events only: a server event makes no lane", () => {
		ingest([
			ev('region.hydrate.start', 100, { fp: 'a', entry: 'A' }),
			ev('region.hydrate.done', 110, { fp: 'a', entry: 'A' }),
			ev('region.hydrate.start', 105, { fp: 's', entry: 'S', realm: 'server' })
		]);
		expect(lanes(html())).toEqual(['a']);
	});

	it('draws only this page: the regions of the page before the last navigation are gone', () => {
		ingest([
			ev('region.hydrate.start', 100, { fp: 'old', entry: 'Old' }),
			ev('region.hydrate.done', 110, { fp: 'old', entry: 'Old' }),
			ev('nav.start', 200, { domain: 'nav', to: '/b' }),
			ev('nav.finish', 260, { domain: 'nav', to: '/b' }),
			ev('region.hydrate.start', 270, { fp: 'new', entry: 'New' }),
			ev('region.hydrate.done', 280, { fp: 'new', entry: 'New' })
		]);
		// (the last navigation is the router's own `navigated` hook, as the dock reads it)
		record_hook('navigated', {
			from: '/a',
			to: '/b',
			type: 'link',
			t: 200,
			fetched: 220,
			styled: 240,
			swapped: 260,
			reconciled: true
		});
		expect(lanes(html())).toEqual(['page', 'new']);
	});

	it("keeps a region's first event of each kind: a live region's later hydrations do not stretch the axis", () => {
		ingest([
			ev('region.hydrate.start', 100, { fp: 'a', entry: 'A' }),
			ev('region.hydrate.done', 110, { fp: 'a', entry: 'A' }),
			ev('region.hydrate.start', 120_000, { fp: 'a', entry: 'A' })
		]);
		expect(html()).toContain('10.0 ms total');
	});

	it('leaves the bar of a region still waking open', () => {
		ingest([
			ev('wake.scheduled', 100, { fp: 'a', entry: 'A' }),
			ev('region.hydrate.start', 105, { fp: 'a', entry: 'A' }),
			ev('wake.scheduled', 100, { fp: 'b', entry: 'B' }),
			ev('region.hydrate.done', 140, { fp: 'b', entry: 'B' })
		]);
		const bars = [...html().matchAll(/<div class="bar\b([^"]*)"/g)].map((m) =>
			m[1].split(' ').includes('open')
		);
		expect(bars).toEqual([true, false]);
	});
});
