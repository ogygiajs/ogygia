// Region.svelte's server render, as one request renders a page of regions on Kit's pass: a spread
// of the region grid's own cases (packages/core/test/_region-grid.ts), forty of each kind, with the
// grid's stand-in build answers. Counts what Region decides and writes per region.
import { bench } from '@bench/heisenbench/bench';
import { server_out } from '../test/_region-grid-server.ts';
import { cases_of, props_for, type GridCase, type Place } from '../test/_region-grid.ts';

const PAGE: Place = { at: 'page', kit: 'pass', csr: 'off', page: 'ok', env: 'prod' };
const PER_KIND = 40;

function spread(kind: string, n: number): GridCase[] {
	const all = cases_of(kind);
	const step = Math.max(1, Math.floor(all.length / n));
	return Array.from({ length: Math.min(n, all.length) }, (_, i) => all[i * step]!);
}

function page_of(kinds: readonly string[], n: number) {
	const cases = kinds.flatMap((k) => spread(k, n));
	return { first: cases[0]!, cases };
}

const render_page = ({ first, cases }: ReturnType<typeof page_of>) =>
	server_out(first, PAGE, () => cases.map(props_for), false).text.length;

for (const kind of ['island', 'hole', 'lake', 'deferred'] as const)
	bench(`region SSR: forty ${kind} regions on Kit's pass`, render_page, {
		setup: () => page_of([kind], PER_KIND),
		scale: (_, k) => page_of([kind], PER_KIND * k)
	});

bench('region SSR: a page of every kind on Kit’s pass', render_page, {
	setup: () =>
		page_of(['island', 'hole', 'lake', 'inline', 'dual', 'deferred', 'promise', 'nothing'], 10),
	scale: (_, k) =>
		page_of(['island', 'hole', 'lake', 'inline', 'dual', 'deferred', 'promise', 'nothing'], 10 * k)
});
