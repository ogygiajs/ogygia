// THE SERVER GRID: every combination of Region's inputs (test/_region-grid.ts) rendered on the
// server at every place, in dev and production, with Svelte's async compile on (the `node` project)
// and off (`node-no-async`). Each case is one request's render: head, body, the document tail on
// Kit's pass, early holes, page records, devtools events, and what reached the console.
//
// One file per kind and place in the page (__snapshots__/region-grid/server/…): every distinct
// output in full, hashes as numbered placeholders, with the cases that give it by their axis values,
// and under it the real hashes each case's placeholders stood for (test/_region-grid-report.ts).
// A combination Region refuses is an output too: its coded error, in full. Every case also holds the
// grid's checks: no throw but a coded refusal, Svelte's markers balanced, good HTML.
//
// Core's `e2e` task runs it (scripts/region-grid.ts), cut into OGYGIA_REGION_GRID_SHARD=<i>/<n>;
// the unit run leaves it out.
import './_region-grid-devtools.ts';
import { afterEach, describe, expect, inject, test, vi } from 'vitest';
import { AT, cases_of, CSR, ENV, KINDS, KIT, PAGE, PLACES, rejected_code } from './_region-grid.ts';
import { server_out } from './_region-grid-server.ts';
import { html_findings, unbalanced_markers } from './_region-grid-checks.ts';
import { GridReport } from './_region-grid-report.ts';

const ASYNC = inject('svelte_async') ? 'on' : 'off';
const SHARD = inject('region_grid_shard').split('/').map(Number);

const CELLS = Object.keys(KINDS).flatMap((kind) => AT.map((at) => ({ kind, at })));
const MINE = CELLS.filter((_c, i) => i % SHARD[1] === SHARD[0] - 1);

afterEach(() => {
	vi.unstubAllEnvs();
});

describe(`async=${ASYNC}`, () => {
	for (const { kind, at } of MINE)
		test(`kind=${kind} at=${at}`, async () => {
			const report = new GridReport({
				kit: KIT,
				csr: CSR,
				page: PAGE,
				env: ENV,
				...KINDS[kind].axes
			});
			const broken: string[] = [];
			for (const place of PLACES.filter((p) => p.at === at)) {
				vi.stubEnv('DEV', place.env === 'dev');
				for (const c of cases_of(kind)) {
					const out = server_out(c, place);
					report.add({ ...place, ...c.values }, out.parts);
					const name = `${c.name} kit=${place.kit} csr=${place.csr} page=${place.page} env=${place.env}`;
					if (out.thrown && !rejected_code(out.thrown)) broken.push(`${name}: threw ${out.thrown}`);
					for (const p of unbalanced_markers(out.body)) broken.push(`${name}: body: ${p}`);
					for (const p of unbalanced_markers(out.head)) broken.push(`${name}: head: ${p}`);
					for (const p of html_findings(out.head, out.body, out.tail)) broken.push(`${name}: ${p}`);
				}
			}
			expect(broken.slice(0, 20)).toEqual([]);
			await expect(
				report.render(`Region server grid · async=${ASYNC} · kind=${kind} · at=${at} (full)`)
			).toMatchFileSnapshot(
				`./__snapshots__/region-grid/server/full/async=${ASYNC}/kind=${kind}/at=${at}.txt`
			);
		}, 1_800_000);
});

declare module 'vitest' {
	export interface ProvidedContext {
		/** Whether this project compiles Svelte with `experimental.async` on. */
		svelte_async: boolean;
		/** Which part of Region's grid runs: `<i>/<n>` (OGYGIA_REGION_GRID_SHARD). */
		region_grid_shard: string;
		/** OGYGIA_FUZZ_RUNS and OGYGIA_FUZZ_SEED, for the browser's fuzz ('' when unset). */
		fuzz_runs: string;
		fuzz_seed: string;
	}
}
