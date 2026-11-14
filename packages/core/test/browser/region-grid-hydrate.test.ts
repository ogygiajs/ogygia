// THE HYDRATION GRID: every combination of Region's inputs (test/_region-grid.ts, the server-only
// axes left out) rendered on the server and hydrated over that HTML in the browser, at every place
// a browser hydrates a region (Kit's pass over a csr=true page and error page, an island's hydrate
// of what is nested in it, a live snippet's body, a woken hole's answer), in dev and production,
// with Svelte's async compile on and off, in Chromium, Firefox and WebKit (one file: they must
// agree). The server leg is compiled by the same project's Vite server (the `region_grid_ssr`
// command). One file per kind and place in the page (__snapshots__/region-grid/hydrate/…): each
// part (whether the server's nodes were kept, head nodes gone, the DOM right after hydration and
// after it settles, live values, the throw, the console) in full, with the cases that give it
// (test/_region-grid-report.ts). Every case also holds: the inputs agree on both legs, so nothing is
// discarded (every server node kept, head and body) and Svelte says nothing about hydration.
import { afterEach, beforeAll, describe, expect, inject, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { cases_of, CSR, ENV, KINDS, PAGE, rejected_code, type Place } from '../_region-grid.ts';
import { GridReport } from '../_region-grid-report.ts';
import {
	HYDRATE_PLACES,
	define_region_element,
	hydrate_out,
	parts_of
} from './_region-grid-client.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		region_grid_ssr: (
			kind: string,
			place: Place
		) => Promise<Array<{ name: string; head: string; body: string; thrown: string | null }>>;
	}
}

const ASYNC = inject('svelte_async') ? 'on' : 'off';
const FULL = inject('region_grid') === 'full';
const SHARD = inject('region_grid_shard').split('/').map(Number);

const HYDRATE_AT = [...new Set(HYDRATE_PLACES.map((p) => p.client.at))];
const FAST_AT: readonly string[] = ['page', 'island'];
const CELLS = Object.keys(KINDS).flatMap((kind) =>
	HYDRATE_AT.filter((at) => FULL || FAST_AT.includes(at)).map((at) => ({ kind, at }))
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
			const k = KINDS[kind];
			const axes = Object.fromEntries(
				Object.entries(k.axes).filter(([a]) => !k.server_only?.includes(a))
			);
			const report = new GridReport({ csr: CSR, page: PAGE, env: envs, ...axes });
			const broken: string[] = [];
			const cases = cases_of(kind, 'client');
			for (const place of HYDRATE_PLACES.filter(
				(p) => p.client.at === at && envs.includes(p.client.env)
			)) {
				const ssr = await commands.region_grid_ssr(kind, place.server);
				vi.stubEnv('DEV', place.client.env === 'dev');
				const where = { csr: place.client.csr, page: place.server.page, env: place.client.env };
				for (const [i, c] of cases.entries()) {
					const server = ssr[i];
					expect(server.name).toBe(c.name);
					const name = `${c.name} csr=${where.csr} page=${where.page} env=${where.env}`;
					if (server.thrown) {
						if (!rejected_code(server.thrown))
							broken.push(`${name}: the server threw ${server.thrown}`);
						report.add({ ...where, ...c.values }, { 'server thrown': server.thrown });
						continue;
					}
					const out = await hydrate_out(c, place.client, server);
					report.add({ ...where, ...c.values }, parts_of(out.text));
					const thrown = (JSON.parse(out.text) as { thrown: string | null }).thrown;
					if (!rejected_code(thrown)) for (const p of out.problems) broken.push(`${name}: ${p}`);
				}
			}
			expect(broken.slice(0, 20)).toEqual([]);
			const set = FULL ? 'full' : 'fast';
			await expect(
				report.render(`Region hydration grid · async=${ASYNC} · kind=${kind} · at=${at} (${set})`)
			).toMatchFileSnapshot(
				`./__snapshots__/region-grid/hydrate/${set}/async=${ASYNC}/kind=${kind}/at=${at}.txt`
			);
		}, 1_800_000);
});
