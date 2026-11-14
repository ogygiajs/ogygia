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
// The full grid is OGYGIA_REGION_GRID=full, cut into OGYGIA_REGION_GRID_SHARD=<i>/<n>; by default
// the fast subset runs (on a page and in an island, production only: its files are its own).
import './_region-grid-devtools.ts';
import { afterEach, describe, expect, inject, test, vi } from 'vitest';
import { AT, cases_of, CSR, ENV, KINDS, KIT, PAGE, PLACES, rejected_code } from './_region-grid.ts';
import { server_out } from './_region-grid-server.ts';
import { html_findings, unbalanced_markers } from './_region-grid-checks.ts';
import { GridReport } from './_region-grid-report.ts';

const ASYNC = inject('svelte_async') ? 'on' : 'off';
const FULL = inject('region_grid') === 'full';
const SHARD = inject('region_grid_shard').split('/').map(Number);

/** The fast subset: on a page and in an island, in production. */
const FAST_AT: readonly string[] = ['page', 'island'];
const CELLS = Object.keys(KINDS).flatMap((kind) =>
	AT.filter((at) => FULL || FAST_AT.includes(at)).map((at) => ({ kind, at }))
);
const MINE = CELLS.filter((_c, i) => i % SHARD[1] === SHARD[0] - 1);

afterEach(() => {
	vi.unstubAllEnvs();
});

describe(`async=${ASYNC}`, () => {
	for (const { kind, at } of MINE)
		test(`kind=${kind} at=${at}`, async () => {
			const envs: readonly string[] = FULL ? ENV : ['prod'];
			const report = new GridReport({
				kit: KIT,
				csr: CSR,
				page: PAGE,
				env: envs,
				...KINDS[kind].axes
			});
			const broken: string[] = [];
			for (const place of PLACES.filter((p) => p.at === at && envs.includes(p.env))) {
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
			const set = FULL ? 'full' : 'fast';
			await expect(
				report.render(`Region server grid · async=${ASYNC} · kind=${kind} · at=${at} (${set})`)
			).toMatchFileSnapshot(
				`./__snapshots__/region-grid/server/${set}/async=${ASYNC}/kind=${kind}/at=${at}.txt`
			);
		}, 1_800_000);
});

declare module 'vitest' {
	export interface ProvidedContext {
		/** Whether this project compiles Svelte with `experimental.async` on. */
		svelte_async: boolean;
		/** Which region grid cases run: `full`, or `fast` (vitest.config.ts, OGYGIA_REGION_GRID). */
		region_grid: string;
		/** Which part of them: `<i>/<n>` (OGYGIA_REGION_GRID_SHARD). */
		region_grid_shard: string;
		/** OGYGIA_FUZZ_RUNS and OGYGIA_FUZZ_SEED, for the browser's fuzz ('' when unset). */
		fuzz_runs: string;
		fuzz_seed: string;
	}
}
