/**
 * The page half of the browser probe (browser-probe.ts drives it in Chromium, Firefox and WebKit):
 * how long a worker takes to start, and one region re-render on the main thread vs in the worker,
 * round trip included (rows cloned in, HTML cloned out, then parsed and put in the page).
 */
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import Table from '../regions/Table.svelte';
import { make_rows, type Row } from '../data.ts';

const table = Table as unknown as Component<{ title: string; rows: Row[] }>;
const RUNS = 30;

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return Math.round(s[Math.floor(s.length / 2)]! * 100) / 100;
}

function place(html: string): void {
	const host = document.getElementById('host')!;
	host.replaceChildren(document.createRange().createContextualFragment(html));
}

async function main(): Promise<Record<string, number>> {
	const rows = make_rows(600, 1);
	const spawn_started = performance.now();
	const worker = new Worker(new URL('./probe-worker.js', import.meta.url), { type: 'module' });
	let next = 0;
	const waiting = new Map<number, (v: { html: string; ms: number }) => void>();
	await new Promise<void>((resolve) => {
		worker.onmessage = (
			e: MessageEvent<{ ready?: true; id: number; html: string; ms: number }>
		) => {
			if (e.data.ready) return resolve();
			waiting.get(e.data.id)?.(e.data);
			waiting.delete(e.data.id);
		};
	});
	const spawn_ms = performance.now() - spawn_started;
	const ask = (r: Row[]): Promise<{ html: string; ms: number }> =>
		new Promise((resolve) => {
			const id = ++next;
			waiting.set(id, resolve);
			worker.postMessage({ id, rows: r });
		});

	const main_render: number[] = [];
	const main_total: number[] = [];
	const worker_render: number[] = [];
	const worker_total: number[] = [];
	const worker_main_busy: number[] = [];
	for (let i = 0; i < RUNS; i++) {
		let t = performance.now();
		const html = render(table, { props: { title: 'Orders', rows } }).body;
		main_render.push(performance.now() - t);
		place(html);
		main_total.push(performance.now() - t);

		t = performance.now();
		const answer = await ask(rows);
		const landed = performance.now();
		place(answer.html);
		const done = performance.now();
		worker_render.push(answer.ms);
		worker_total.push(done - t);
		// the main thread's own share: posting the rows (clone) is in `t`..post, placing is landed..done
		worker_main_busy.push(done - landed);
	}
	worker.terminate();
	return {
		spawn_ms: Math.round(spawn_ms * 100) / 100,
		html_kb: Math.round(render(table, { props: { title: 'Orders', rows } }).body.length / 1024),
		main_render_ms: median(main_render),
		main_render_and_place_ms: median(main_total),
		worker_render_ms: median(worker_render),
		worker_round_trip_and_place_ms: median(worker_total),
		worker_main_thread_place_ms: median(worker_main_busy)
	};
}

(globalThis as { __probe?: Promise<Record<string, number>> }).__probe = main();
