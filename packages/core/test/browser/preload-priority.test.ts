// PRIORITY INHERITANCE FOR AN ISLAND'S DOWNLOAD (#437): a speculative warm (a page prefetch) starts
// an island's code at a low priority. When the visitor then needs it (it wakes on screen, or they
// reach for it), the load it joins is raised to their priority, never left at the guess's.
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
	preload_island_graph,
	reset_island_graph
} from '../../src/runtime/island-graph-preload.ts';
import { OGYGIA_GRAPH_PRELOAD as GRAPH_PRELOAD_ATTR } from '../../src/wire-markup.ts';
import { warm_island_module } from '../../src/runtime/region-endpoint-url.ts';
import {
	BACKGROUND_WINDOW,
	LoadSlot,
	reset_load_scheduler
} from '../../src/runtime/load-scheduler.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';
import { PRIORITY } from '../../src/runtime/load-class.ts';
import { flights, observe } from '@ogygia/machine';
import { island_graph_script } from '../../src/server/document-tail.ts';

const priorities = () =>
	[...document.head.querySelectorAll(`link[${GRAPH_PRELOAD_ATTR}]`)].map(
		(l) => l.getAttribute('fetchpriority') ?? 'auto'
	);
const requested = (part: string) =>
	performance.getEntriesByType('resource').filter((r) => r.name.includes(part));

let host: HTMLElement;
beforeEach(() => {
	reset_island_graph();
	reset_load_scheduler();
	reset_document_painted();
	host = document.createElement('div');
	host.innerHTML = island_graph_script(new Map([['/g/a.js', ['/g/svelte.js', '/g/a-dep.js']]]));
	document.body.append(host);
});
afterEach(() => {
	host.remove();
	document.head.querySelectorAll(`link[${GRAPH_PRELOAD_ATTR}]`).forEach((l) => l.remove());
	document.body.querySelectorAll('img').forEach((i) => i.remove());
});

test('a graph a speculative warm linked low is raised when a visible wake joins it', () => {
	preload_island_graph('/g/a.js', undefined, 'low');
	expect(priorities()).toEqual(['low', 'low']);
	preload_island_graph('/g/a.js', undefined, 'auto');
	expect(priorities()).toEqual(['auto', 'auto']);
});

test('a click wake raises it to high, and a later guess never lowers it', () => {
	preload_island_graph('/g/a.js', undefined, 'low');
	preload_island_graph('/g/a.js', undefined, 'high');
	expect(priorities()).toEqual(['high', 'high']);
	preload_island_graph('/g/a.js', undefined, 'low');
	expect(priorities()).toEqual(['high', 'high']);
});

test('a download lifted to a class is never lowered by a later, lesser join', () => {
	let slot!: LoadSlot;
	const downloads = flights({
		run: (_key: string, _signal, flight) => {
			slot = new LoadSlot({ kind: 'code', cls: 'speculative', flight });
			return slot.ready;
		}
	});
	void downloads.get('a', { priority: PRIORITY.speculative });
	void downloads.get('a', { priority: PRIORITY.user });
	void downloads.get('a', { priority: PRIORITY.ahead });
	expect(slot.cls()).toBe('user');
});

test('a warm whose keep ran out warms the module again on the next ask', async () => {
	const moves: string[] = [];
	const off = observe((name, from, to) => {
		if (name === 'island warm' && to) moves.push(`${from.kind} -> ${to.kind}`);
	});
	const platform = globalThis as { buggify?: (point: string) => boolean };
	try {
		const entry = '/test/browser/fixtures/entry-current.ts?t=warm-kept';
		warm_island_module(entry, undefined, 'user');
		await expect.poll(() => moves, { timeout: 3000 }).toContain('flying -> kept');
		// (its keep runs out at this ask, as a short keep's would: the simulator's buggify point)
		platform.buggify = (point) => point === 'flights.evicted-early';
		warm_island_module(entry, undefined, 'user');
		delete platform.buggify;
		await expect
			.poll(() => moves, { timeout: 3000 })
			.toEqual(['flying -> kept', 'kept -> gone', 'flying -> kept']);
	} finally {
		delete platform.buggify;
		off();
	}
});

test('a hover joins a prefetch warm still queued: the warm starts now, at the visitor priority', async () => {
	// the background window is full: a speculative download waits its turn
	await Promise.all(
		Array.from(
			{ length: BACKGROUND_WINDOW },
			() => new LoadSlot({ kind: 'code', cls: 'speculative' }).ready
		)
	);
	const entry = '/test/browser/fixtures/entry-current.ts?t=437';
	warm_island_module(entry); // a page prefetch's warm: speculative, queued behind the window
	await new Promise((r) => setTimeout(r, 50));
	// (the dev server serves it as `entry-current.ts?import&t=437`)
	expect(requested('t=437')).toHaveLength(0);
	warm_island_module(entry, undefined, 'user'); // the visitor reaches for it
	await expect.poll(() => requested('t=437').length, { timeout: 3000 }).toBe(1);
});
