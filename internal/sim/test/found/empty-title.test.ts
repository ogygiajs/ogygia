// FOUND BY THE SIMULATOR (seed 4, no network faults): after client navigations, a page whose server
// HTML has no <title> shows an empty <title> element in its head, which a fresh load of the same URL
// does not have. The router sets `document.title = doc.title` (packages/core/src/runtime/router-nav.ts),
// and setting `document.title` creates a <title> when there is none (the HTML spec; browsers do it
// too). The page should equal a fresh hard load. (#786; skipped without `OGYGIA_RULES=1 vite build`
// in apps/palaestra.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('found: empty title', () => {
	it('a page with no <title> keeps none after client navigations to it (seed 4)', async () => {
		const res = await run(4, 12);
		expect(res.broken.map((b) => `${b.oracle}: ${b.detail}`)).toEqual([]);
	}, 300_000);
});
