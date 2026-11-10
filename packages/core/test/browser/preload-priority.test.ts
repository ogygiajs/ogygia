// PRIORITY INHERITANCE FOR AN ISLAND'S DOWNLOAD (#437): a speculative warm (a page prefetch) starts
// an island's code at a low priority. When the visitor then needs it (it wakes on screen, or they
// reach for it), the load it joins is raised to their priority, never left at the guess's.
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
	GRAPH_PRELOAD_ATTR,
	preload_island_graph,
	reset_island_graph
} from '../../src/runtime/island-graph-preload.ts';
import { warm_island_module } from '../../src/runtime/region-endpoint-url.ts';
import { reset_load_scheduler } from '../../src/runtime/load-scheduler.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';
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

test('a hover joins a prefetch warm still queued: the warm starts now, at the visitor priority', async () => {
	// the page's critical image has not arrived: a speculative download waits for it
	const hero = document.createElement('img');
	hero.setAttribute('fetchpriority', 'high');
	Object.defineProperty(hero, 'complete', { configurable: true, get: () => false });
	document.body.append(hero);
	const entry = '/test/browser/fixtures/entry-current.ts?t=437';
	warm_island_module(entry); // a page prefetch's warm: speculative, queued behind the hero
	await new Promise((r) => setTimeout(r, 50));
	expect(requested('entry-current.ts?t=437')).toHaveLength(0);
	warm_island_module(entry, undefined, 'user'); // the visitor reaches for it
	await expect.poll(() => requested('entry-current.ts?t=437').length, { timeout: 3000 }).toBe(1);
});
