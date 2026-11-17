// A region given a snippet prop: the server freezes the snippet to its HTML, and the browser takes
// the same prop. Created fresh in the browser it freezes the snippet itself; hydrated over the
// server's HTML it keeps the server's frozen snippet. Found by the Region grid (#1952, #1953).
import { beforeAll, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { spec_case, spec_props, type Place, type Spec } from '../_region-grid.ts';
import { client_out, define_region_element, hydrate_out, parts_of } from './_region-grid-client.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		region_grid_ssr_specs: (
			inputs: Array<{ spec: Spec; place: Place }>
		) => Promise<Array<{ head: string; body: string; thrown: string | null }>>;
	}
}

beforeAll(() => define_region_element());

const spec = (kind: string, values: Record<string, string>): Spec => ({
	kind,
	values,
	raw: {},
	of_raw: {},
	stray: []
});

/** The snippet prop's HTML as its frozen copy rides in the props sidecar (devalue writes `<` so). */
const FROZEN = '\\u003Cu>s\\u003C/u>';

const HOLE = spec('hole', {
	when: 'load',
	wake: 'load',
	attrs: 'none',
	ttl: '0',
	fallback: 'none',
	props: 'snippet',
	component: 'tiny',
	building: 'no',
	page_version: 'no'
});

const ISLAND = spec('island', {
	wake: 'load',
	keep: 'none',
	children: 'none',
	component: 'tiny',
	props: 'snippet',
	ttl: '0',
	known: 'no'
});

for (const env of ['dev', 'prod'] as const) {
	test(`a hole given a snippet prop is created in the browser with the snippet frozen (${env})`, async () => {
		vi.stubEnv('DEV', env === 'dev');
		try {
			for (const csr of ['off', 'on'] as const) {
				const out = parts_of(await client_out(spec_case(HOLE), { at: 'page', csr, env }));
				expect(out.thrown).toBe('null');
				expect(out.body).toContain(FROZEN);
			}
		} finally {
			vi.unstubAllEnvs();
		}
	});

	test(`a hole given a snippet prop hydrates over its server HTML on a csr page (${env})`, async () => {
		const server_place: Place = { at: 'page', csr: 'on', kit: 'pass', page: 'ok', env };
		const [server] = await commands.region_grid_ssr_specs([{ spec: HOLE, place: server_place }]);
		expect(server.thrown).toBeNull();
		vi.stubEnv('DEV', env === 'dev');
		try {
			const out = await hydrate_out(spec_case(HOLE), { at: 'page', csr: 'on', env }, server, () =>
				spec_props(HOLE)
			);
			expect(out.problems).toEqual([]);
			expect(parts_of(out.text).body_after).toContain(FROZEN);
		} finally {
			vi.unstubAllEnvs();
		}
	});

	test(`a hole given a snippet prop and rebuilt in the browser keeps the address the server gave it (${env})`, async () => {
		const server_place: Place = { at: 'page', csr: 'on', kit: 'pass', page: 'ok', env };
		const [server] = await commands.region_grid_ssr_specs([{ spec: HOLE, place: server_place }]);
		const address = (body: string) => /data-og-hole="([^"]+)"/.exec(body)?.[1];
		expect(address(server.body)).toBeTruthy();
		vi.stubEnv('DEV', env === 'dev');
		try {
			const out = parts_of(await client_out(spec_case(HOLE), { at: 'page', csr: 'on', env }));
			expect(address(out.body)).toBe(address(server.body));
		} finally {
			vi.unstubAllEnvs();
		}
	});

	test(`a top-level island given a snippet prop is created in the browser with the snippet frozen (${env})`, async () => {
		vi.stubEnv('DEV', env === 'dev');
		try {
			const out = parts_of(await client_out(spec_case(ISLAND), { at: 'page', csr: 'off', env }));
			expect(out.thrown).toBe('null');
			expect(out.body).toContain(FROZEN);
		} finally {
			vi.unstubAllEnvs();
		}
	});
}
