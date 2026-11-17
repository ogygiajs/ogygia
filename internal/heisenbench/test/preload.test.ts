import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PRELOAD = fileURLToPath(new URL('../src/preload.ts', import.meta.url));
const CORE_TEST = new URL('../../../packages/core/test/', import.meta.url).href;

function run(code: string): string {
	return execFileSync(
		process.execPath,
		['--import', PRELOAD, '--input-type=module', '--eval', code],
		{ encoding: 'utf8' }
	);
}

test('the region bench renders Region for real, not a thrown $derived', () => {
	const out = run(`
		const { server_out } = await import('${CORE_TEST}_region-grid-server.ts');
		const { cases_of, props_for } = await import('${CORE_TEST}_region-grid.ts');
		const place = { at: 'page', kit: 'pass', csr: 'off', page: 'ok', env: 'prod' };
		for (const kind of ['island', 'hole', 'lake', 'deferred']) {
			const c = cases_of(kind)[0];
			console.log(server_out(c, place, () => [props_for(c)], false).text);
		}
	`);
	assert.match(out, /<!-- body -->[^\n]/);
	assert.doesNotMatch(out, /<!-- thrown -->[^\n]/);
	assert.doesNotMatch(out, /is not defined/);
});
