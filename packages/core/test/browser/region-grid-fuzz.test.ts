// THE REGION FUZZ (hydration leg): the grid's inputs with raw text over every prop Region writes as
// text, props of any JSON shape, and props of another kind (test/_region-grid-arb.ts), rendered on
// the server (the `region_grid_ssr_specs` command, this project's own compile) and hydrated over
// that HTML at a place a browser hydrates one, in Chromium, Firefox and WebKit, async on and off.
// The inputs agree on both legs, so: nothing thrown but a coded refusal, every server node kept
// (head and body), and Svelte says nothing about hydration. Seeded (314, or OGYGIA_FUZZ_SEED);
// OGYGIA_FUZZ_RUNS sets how many inputs. A failure prints its input, as plain data, to replay.
import { beforeAll, expect, inject, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { fc } from '@ogygia/config/html-fuzz';
import { rejected_code, spec_case, spec_props, type Place, type Spec } from '../_region-grid.ts';
import { spec_arb } from '../_region-grid-arb.ts';
import { HYDRATE_PLACES, define_region_element, hydrate_out } from './_region-grid-client.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		region_grid_ssr_specs: (
			inputs: Array<{ spec: Spec; place: Place }>
		) => Promise<Array<{ head: string; body: string; thrown: string | null }>>;
	}
}

const RUNS = Number(inject('fuzz_runs') || 600);
const SEED = Number(inject('fuzz_seed') || 314);
const BATCH = 1000;

beforeAll(() => define_region_element());

test('any input hydrates over its own server HTML with nothing discarded and nothing said', async () => {
	const inputs = fc.sample(
		fc.record({ spec: spec_arb('mixed'), at: fc.nat(HYDRATE_PLACES.length - 1) }),
		{ numRuns: RUNS, seed: SEED }
	);
	const broken: string[] = [];
	let ssr: Awaited<ReturnType<typeof commands.region_grid_ssr_specs>> = [];
	for (const [i, { spec, at }] of inputs.entries()) {
		// (the server leg in batches: one answer for every input at once is too big to send)
		if (i % BATCH === 0)
			ssr = await commands.region_grid_ssr_specs(
				inputs
					.slice(i, i + BATCH)
					.map((input) => ({ spec: input.spec, place: HYDRATE_PLACES[input.at].server }))
			);
		const place = HYDRATE_PLACES[at];
		const server = ssr[i % BATCH];
		const input = JSON.stringify({ spec, place: place.client });
		if (server.thrown) {
			if (!rejected_code(server.thrown)) broken.push(`${input}: the server threw ${server.thrown}`);
			continue;
		}
		vi.stubEnv('DEV', place.client.env === 'dev');
		const out = await hydrate_out(spec_case(spec), place.client, server, () => spec_props(spec));
		vi.unstubAllEnvs();
		const thrown = (JSON.parse(out.text) as { thrown: string | null }).thrown;
		if (!rejected_code(thrown)) for (const p of out.problems) broken.push(`${input}: ${p}`);
	}
	expect(broken.slice(0, 10)).toEqual([]);
}, 3_600_000);
