// THE CLIENT GRID: every combination of Region's inputs (test/_region-grid.ts, the server-only
// axes left out) created fresh in the browser (a client navigation, an island re-creating it, Kit
// mounting fresh) at every place the browser creates one, in dev and production, with Svelte's async
// compile on (`browser`) and off (`browser-no-async`), in Chromium, Firefox and WebKit (the three
// share one file: they must agree). One file per kind and place in the page
// (__snapshots__/region-grid/client/…): each part of the output (the body, each value handed to a
// live element, the throw, what reached the console) in full, with the cases that give it
// (test/_region-grid-report.ts). Every case also holds: no throw but a coded refusal, and the head
// left as it was (the browser never writes a region's head).
//
// OGYGIA_REGION_GRID=full runs every place, OGYGIA_REGION_GRID_SHARD=<i>/<n> a part of them; by
// default the fast subset (on a page and in an island, production; its files are its own).
import { afterEach, beforeAll, describe, expect, inject, test, vi } from 'vitest';
import { AT, cases_of, CSR, ENV, KINDS, rejected_code } from '../_region-grid.ts';
import { GridReport } from '../_region-grid-report.ts';
import {
	CLIENT_PLACES,
	client_out,
	define_region_element,
	parts_of
} from './_region-grid-client.ts';

const ASYNC = inject('svelte_async') ? 'on' : 'off';
const FULL = inject('region_grid') === 'full';
const SHARD = inject('region_grid_shard').split('/').map(Number);

const FAST_AT: readonly string[] = ['page', 'island'];
const CELLS = Object.keys(KINDS).flatMap((kind) =>
	AT.filter((at) => FULL || FAST_AT.includes(at)).map((at) => ({ kind, at }))
);
const MINE = CELLS.filter((_c, i) => i % SHARD[1] === SHARD[0] - 1);

beforeAll(() => define_region_element());
afterEach(() => {
	vi.unstubAllEnvs();
});

describe(`async=${ASYNC}`, () => {
	for (const { kind, at } of MINE)
		test(`kind=${kind} at=${at}`, async () => {
			const envs: readonly string[] = FULL ? ENV : ['prod'];
			const cases = cases_of(kind, 'client');
			const report = new GridReport({ csr: CSR, env: envs, ...cases_axes(kind) });
			const broken: string[] = [];
			for (const place of CLIENT_PLACES.filter((p) => p.at === at && envs.includes(p.env))) {
				vi.stubEnv('DEV', place.env === 'dev');
				for (const c of cases) {
					const out = await client_out(c, place);
					report.add({ ...place, ...c.values }, parts_of(out));
					const name = `${c.name} csr=${place.csr} env=${place.env}`;
					const parsed = JSON.parse(out) as { thrown: string | null; head_changed: boolean };
					if (parsed.thrown && !rejected_code(parsed.thrown))
						broken.push(`${name}: threw ${parsed.thrown}`);
					if (parsed.head_changed) broken.push(`${name}: wrote the head`);
				}
			}
			expect(broken.slice(0, 20)).toEqual([]);
			const set = FULL ? 'full' : 'fast';
			await expect(
				report.render(`Region client grid · async=${ASYNC} · kind=${kind} · at=${at} (${set})`)
			).toMatchFileSnapshot(
				`./__snapshots__/region-grid/client/${set}/async=${ASYNC}/kind=${kind}/at=${at}.txt`
			);
		}, 1_800_000);
});

/** A kind's axes on the client leg (the server-only ones left out). */
function cases_axes(kind: string): Record<string, readonly string[]> {
	const k = KINDS[kind];
	return Object.fromEntries(Object.entries(k.axes).filter(([a]) => !k.server_only?.includes(a)));
}
