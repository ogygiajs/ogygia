// FOUND BY THE SIMULATOR (palaestra, seed 610518297; #2108), 3 actions: the visitor clicks a link,
// the router's build throws (buggify) and it hands the visit to the browser (`location.replace`);
// that document's answer is cut on the way. The browser shows its own error, and nothing escapes:
// happy-dom's `location` rethrew the failure once the page that set it was unloaded, and the run
// counted it as an uncaught error. (Skipped without the app built for the simulator.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const built = existsSync(`${APP}/.svelte-kit/output/server/index.js`);

describe.skipIf(!built)('found: a navigation handed to the browser whose answer is cut', () => {
	it('escapes as no uncaught error (2fc21876bb)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(610518297, 3);
		expect(res.broken.filter((b) => signature(b) === '2fc21876bb')).toEqual([]);
	}, 300_000);
});
