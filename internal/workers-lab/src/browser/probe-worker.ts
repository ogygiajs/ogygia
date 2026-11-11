/**
 * Idea 2's question, in a real browser: a web worker that holds a region's SERVER render (Svelte's
 * string-building output) and answers HTML. Messages: { id, rows } in, { id, html, ms } out.
 */
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import Table from '../regions/Table.svelte';
import type { Row } from '../data.ts';

const table = Table as unknown as Component<{ title: string; rows: Row[] }>;

// lives as long as the worker: the page terminates it
self.addEventListener('message', (e: MessageEvent<{ id: number; rows: Row[] }>) => {
	const started = performance.now();
	const html = render(table, { props: { title: 'Orders', rows: e.data.rows } }).body;
	self.postMessage({ id: e.data.id, html, ms: performance.now() - started });
});
self.postMessage({ ready: true });
