// A LOCATION GONE, in a real browser: a page a cache kept names a content-hashed file its build no
// longer serves. The island must still wake — on the file the CURRENT build's map names
// (`<appDir>/ogygia.json`, the one file at a fixed name) — not stay dead. The SSR HTML is the
// Counter island from setup.ts; its identity is a build's name (no file), its location a file that
// 404s, and the fixture map points the identity at the working module.
import { expect, inject, test } from 'vitest';
import { page, server } from 'vitest/browser';
import { bootDev } from '../../src/runtime/full.ts';

const IDENTITY = '/test/browser/fixtures/ogygia/og-region.000000000aa5.js';
const HYDRATED = 'ogygia-region[data-hydrated]';
const counter_html = () => decodeURIComponent(escape(atob(inject('counter_ssr_b64'))));
const requested = (part: string) =>
	performance.getEntriesByType('resource').filter((r) => r.name.includes(part));

test('the location 404s: the island wakes on the current build’s file', async () => {
	document.body.innerHTML = counter_html();
	const region = document.querySelector('ogygia-region')!;
	region.setAttribute('entry', IDENTITY);
	region.setAttribute('src', '/test/browser/fixtures/immutable/og-region.000000000aa5.Gone1234.js');
	bootDev();
	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	// (the fixture's props start it at 3: one press, and it is live)
	await expect.element(page.getByTestId('count')).toHaveTextContent('3');
	await page.getByRole('button', { name: 'add' }).click();
	await expect.element(page.getByTestId('count')).toHaveTextContent('4');
	// the 404 is never asked for again under a fresh URL (the server answered for it); Firefox may
	// fetch it twice when the import starts while its modulepreload is still out (it does not join
	// the two loads, Chromium and WebKit do)
	const gone = requested('og-region.000000000aa5.Gone1234.js');
	expect(gone.filter((r) => r.name.includes('og-retry'))).toHaveLength(0);
	expect(gone.length).toBeLessThanOrEqual(server.browser === 'firefox' ? 2 : 1);
	expect(requested('fixtures/ogygia.json')).toHaveLength(1);
	expect(requested('og-region.000000000aa5.js')).toHaveLength(0);
});
