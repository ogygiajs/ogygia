// A hole's own <ogygia-region> is written by two writers: the shell (a csr=false page) and the
// adopted element (a csr=true page, a live snippet). Each attribute follows one rule in both.
import './_region-grid-devtools.ts';
import { expect, test } from 'vitest';
import { cases_of, type Place } from './_region-grid.ts';
import { server_out } from './_region-grid-server.ts';

const SHELL: Place = { at: 'page', kit: 'none', csr: 'off', page: 'ok', env: 'prod' };
const ADOPTED: Place = { at: 'live-snippet', kit: 'none', csr: 'off', page: 'ok', env: 'prod' };

function hole_tag(place: Place, when: string): string {
	const c = cases_of('hole')[0]!;
	const out = server_out(c, place, () => [
		{ __og: { mode: 'server', entry: 'hole-a', when }, __props: {} }
	]);
	expect(out.thrown).toBeNull();
	return /<ogygia-region\b[^>]*render="defer"[^>]*>/.exec(out.body)?.[0] ?? '';
}

test('an empty fetch schedule is written alike by the shell and the adopted hole', () => {
	const when = (tag: string) => /\swhen="([^"]*)"/.exec(tag)?.[1] ?? null;
	const shell = when(hole_tag(SHELL, ''));
	const adopted = when(hole_tag(ADOPTED, ''));
	expect(shell).toBe(adopted);
	expect(when(hole_tag(SHELL, 'load'))).toBe(shell);
});
