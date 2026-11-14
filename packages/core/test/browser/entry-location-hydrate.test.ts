// AN ISLAND LOADS ITS LOCATION, in a real browser: the server writes the island's identity (`entry`,
// the stable name) and its location (`src`, the content-hashed file). The runtime must import the
// location — the identity is only a key — and, when the location is gone (a page that outlived its
// build), wake from the identity fetched fresh. The SSR HTML is the Counter island from setup.ts.
import { expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { page } from 'vitest/browser';
import { bootDev } from '../../src/runtime/full.ts';

// (the Counter as the build's file for its identity: the iid in its name)
const COUNTER = '/test/browser/fixtures/immutable/og-region.000000000aa5.Cur.js';
const HYDRATED = 'ogygia-region[data-hydrated]';
const counter_html = () => from_b64(inject('counter_ssr_b64'));
const requested = (part: string) =>
	performance.getEntriesByType('resource').filter((r) => r.name.includes(part));

/** The Counter island's SSR with its identity and location set as given. */
function mount(entry: string, src: string | null) {
	document.body.innerHTML = counter_html();
	const region = document.querySelector('ogygia-region')!;
	expect(region.getAttribute('entry')).toContain('Counter.svelte');
	region.setAttribute('entry', entry);
	if (src) region.setAttribute('src', src);
	return region;
}

test('the identity is only a key: a stale stable name that 404s, the island wakes from its location', async () => {
	mount('/test/browser/fixtures/ogygia/og-region.000000000aa5.js', COUNTER);
	bootDev();
	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	// (the fixture's props start it at 3: one press, and it is live)
	await expect.element(page.getByTestId('count')).toHaveTextContent('3');
	await page.getByRole('button', { name: 'add' }).click();
	await expect.element(page.getByTestId('count')).toHaveTextContent('4');
	// the stable name was never asked for
	expect(requested('og-region.000000000aa5.js')).toHaveLength(0);
});
