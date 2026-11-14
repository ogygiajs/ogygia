// An island of OURS on a Kit-hydrated (csr=true) document — here inside a lake, the served header
// shape — reads `page.data` through the bridge Kit's client entry publishes (there is no ogygia page
// seed on a Kit document; Kit's data is the truth). That entry arrives by Kit's boot `import()`, a
// network fetch, while the island is already in the SSR tree and wakes on its own schedule. REGRESSION
// (customer, prod, ~1 in 3 loads): a `wake:'idle'` search-bar island woke while Kit's chunks were still
// downloading, read `page.data` as `{}`, its `{#if page.data.loggedIn}{:else if markup}` took the
// empty branch, and Svelte discarded the server DOM — the search bar vanished. The runtime must not
// hydrate such an island before Kit's page thread exists; its server HTML stays on screen meanwhile.
import { afterEach, expect, inject, test, vi } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { kit_page_thread } from '../../src/runtime/kit-page-thread.svelte.ts';
import {
	publish_kit_page,
	publish_kit_page_deferred,
	unpublish_kit_page
} from './_kit-thread.svelte.ts';

const ISLAND = 'ogygia-region[wake="idle"]';
const inject_html = (key: 'lake_page_reader_ssr_b64') => from_b64(inject(key));

afterEach(() => {
	unpublish_kit_page();
	document.body.innerHTML = '';
});

test('a page-reading island inside a lake on a Kit document waits for Kit’s page thread, then hydrates on the SAME branch', async () => {
	const warns: string[] = [];
	const real_warn = console.warn;
	console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));
	try {
		// Kit's bootstrap marks the document; its client entry (the thread) has NOT run yet.
		document.body.innerHTML = `<script>__sveltekit_lab = {};\x3C/script><div data-mount>${inject_html('lake_page_reader_ssr_b64')}</div>`;
		const island = document.querySelector(ISLAND) as HTMLElement;
		expect(island, 'the fixture is the lake + idle island shape').not.toBeNull();
		const server_branch = island.querySelector('[data-testid="search"]');
		expect(server_branch?.textContent, 'the server took the markup branch').toBe('search');

		bootDev();

		// The island is ours (inside a lake) and wakes on idle — but Kit's page is not there yet, so it
		// must HOLD: no hydrate, no discard, the server DOM untouched.
		await new Promise((r) => setTimeout(r, 600));
		expect(island.hasAttribute('data-hydrated'), 'held until the thread exists').toBe(false);
		expect(island.querySelector('[data-testid="search"]'), 'the server node is still there').toBe(
			server_branch
		);
		expect(warns.filter((w) => w.includes('discarded its ENTIRE'))).toEqual([]);

		// Kit's entry runs: the thread publishes Kit's page — the same data the server rendered from.
		publish_kit_page({ searchBarMarkup: '<i data-testid="search">search</i>' });

		await expect.poll(() => island.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
		// Same branch as the server → the server DOM was claimed, not discarded.
		expect(island.hasAttribute('data-og-recovered'), 'no discard').toBe(false);
		expect(island.querySelector('[data-testid="search"]'), 'the SSR node was adopted').toBe(
			server_branch
		);
		expect(island.querySelector('[data-testid="branch"]')?.textContent).toBe('search');
		expect(warns.filter((w) => w.includes('discarded its ENTIRE'))).toEqual([]);
	} finally {
		console.warn = real_warn;
	}
});

// THE SECOND WINDOW (field, prod, 2/12 loads on a74d14d): the bridge is a LIVE reference assigned when
// Kit's entry EVALUATES, but the page it points at is still Kit's pre-start object (`status = -1`,
// `data = {}`) until `start()`'s `initialize()` applies the server page ~150–350 ms later. A wait that
// resolved on the bridge appearing let the island hydrate against `{}` in that gap — same discard,
// one step later. The island must wait for Kit to APPLY its page, not for the object to exist.
test('the bridge is published but Kit has not applied its page (status -1): the island keeps waiting, and hydrates once initialize() lands it', async () => {
	const warns: string[] = [];
	const real_warn = console.warn;
	console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));
	try {
		// Kit's entry has evaluated (bridge=Y) — but start() has not applied the page (status -1, data {}).
		const kit = publish_kit_page_deferred();
		document.body.innerHTML = `<script>__sveltekit_lab = {};\x3C/script><div data-mount>${inject_html('lake_page_reader_ssr_b64')}</div>`;
		const island = document.querySelector(ISLAND) as HTMLElement;
		const server_branch = island.querySelector('[data-testid="search"]');
		expect(server_branch?.textContent).toBe('search');

		bootDev();

		// bridge=Y, data={} — exactly the moment the field capture shows the island collapsing. It must HOLD.
		await new Promise((r) => setTimeout(r, 400));
		expect(island.hasAttribute('data-hydrated'), 'held: bridge up but data not applied').toBe(
			false
		);
		expect(island.hasAttribute('data-og-recovered'), 'no discard against the empty data').toBe(
			false
		);
		expect(island.querySelector('[data-testid="search"]'), 'the server node is untouched').toBe(
			server_branch
		);
		expect(warns.filter((w) => w.includes('discarded its ENTIRE'))).toEqual([]);

		// start() lands the server blob: page.data is populated — the same data the server rendered from.
		kit.settle({ searchBarMarkup: '<i data-testid="search">search</i>' });

		await expect.poll(() => island.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
		expect(
			island.hasAttribute('data-og-recovered'),
			'same branch as the server → claimed, not discarded'
		).toBe(false);
		expect(island.querySelector('[data-testid="search"]'), 'the SSR node was adopted').toBe(
			server_branch
		);
		expect(island.querySelector('[data-testid="branch"]')?.textContent).toBe('search');
		expect(warns.filter((w) => w.includes('discarded its ENTIRE'))).toEqual([]);
	} finally {
		console.warn = real_warn;
	}
});

// No timeout on the wait by design — but a Kit boot that never happens must not be SILENT in dev.
test('DEV: a wait that runs long warns once (diagnosable), still resolves the moment Kit applies its page', async () => {
	const warns: string[] = [];
	const real_warn = console.warn;
	console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
	try {
		const kit = publish_kit_page_deferred(); // bridge up, status -1: Kit's start() never comes…
		let resolved = false;
		const wait = kit_page_thread();
		expect(wait, 'status -1 → a real wait').not.toBeNull();
		void wait!.then(() => (resolved = true));

		await vi.advanceTimersByTimeAsync(4_900);
		expect(
			warns.filter((w) => w.includes('waited')),
			'quiet before the threshold'
		).toEqual([]);
		await vi.advanceTimersByTimeAsync(200);
		const slow = warns.filter((w) => w.includes('waited'));
		expect(slow).toHaveLength(1);
		expect(slow[0]).toContain('start() has not applied the page');
		expect(resolved, 'the warning is diagnostic only — nothing resolved or discarded').toBe(false);

		// …until it does: the effect on `status` fires, the wait resolves, no second warning.
		kit.settle({ any: 1 });
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();
		expect(resolved).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(warns.filter((w) => w.includes('waited'))).toHaveLength(1);
	} finally {
		vi.useRealTimers();
		console.warn = real_warn;
	}
});

test('a wait for a Kit whose boot import failed ends: it fails with kit_boot_failed, said once (#820)', async () => {
	const errors: string[] = [];
	const real_error = console.error;
	console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
	try {
		// Kit's boot script, as Kit writes it (here only as text: it is not run), importing a file
		// that cannot load.
		document.body.innerHTML =
			'<script>__sveltekit_lab = {};\nimport("/__og_missing__/entry/start.js").then(() => {});</script>';
		const first = kit_page_thread();
		const second = kit_page_thread();
		expect(first, 'Kit has not started → a real wait').not.toBeNull();
		await expect(first).rejects.toMatchObject({ code: 'kit_boot_failed' });
		await expect(second).rejects.toMatchObject({ code: 'kit_boot_failed' });
		// a wait that starts after it failed fails too: the browser keeps the file failed
		await expect(kit_page_thread()).rejects.toMatchObject({ code: 'kit_boot_failed' });
		expect(errors.filter((e) => e.includes('kit_boot_failed'))).toHaveLength(1);
	} finally {
		console.error = real_error;
	}
});

test('a boot-shaped script naming a file on another origin is never imported: markup is not code (#847 review)', async () => {
	// A script that came in as markup (a swapped region, a hole) and never ran looks just like Kit's.
	// Its import names a file on an origin that is neither the page's nor the runtime's.
	document.body.innerHTML =
		'<script>__sveltekit_lab = {};\nimport("http://127.0.0.1:1/x.js").then(() => {});</script>';
	const wait = kit_page_thread();
	expect(wait, 'Kit has not started → a real wait').not.toBeNull();
	let failed: unknown = null;
	void wait!.then(undefined, (e: unknown) => (failed = e));
	await new Promise((r) => setTimeout(r, 500));
	expect(failed, 'the file was not imported, so nothing failed').toBeNull();
	publish_kit_page({ searchBarMarkup: '' });
	await expect(wait).resolves.toBeUndefined();
});

test('only a script that runs and assigns Kit’s global is read as Kit’s boot: a data script or another script is not', async () => {
	document.body.innerHTML = [
		'<script type="application/json">__sveltekit_lab = {};\nimport("/__og_missing__/data/start.js")</script>',
		'<script>window.other = 1;\nimport("/__og_missing__/other/start.js").then(() => {});</script>'
	].join('');
	const wait = kit_page_thread();
	expect(wait, 'Kit has not started → a real wait').not.toBeNull();
	let failed: unknown = null;
	void wait!.then(undefined, (e: unknown) => (failed = e));
	await new Promise((r) => setTimeout(r, 500));
	expect(failed, 'neither file was imported, so nothing failed').toBeNull();
	publish_kit_page({ searchBarMarkup: '' });
	await expect(wait).resolves.toBeUndefined();
});

test('once Kit publishes its page, the global is a plain value again: Kit can assign it anew', async () => {
	const wait = kit_page_thread();
	expect(wait).not.toBeNull();
	publish_kit_page({ searchBarMarkup: '' });
	await expect(wait).resolves.toBeUndefined();
	const d = Object.getOwnPropertyDescriptor(globalThis, Symbol.for('ogygia.kit-page'));
	expect(d && 'value' in d).toBe(true);
	expect(d?.get === undefined).toBe(true);
});

test('a Kit page applied with no data is no wait: empty data is still an applied page', () => {
	publish_kit_page({});
	expect(kit_page_thread()).toBeNull();
});

test('with the thread already published at wake there is no hold: the island hydrates straight away', async () => {
	publish_kit_page({ searchBarMarkup: '<i data-testid="search">search</i>' });
	document.body.innerHTML = `<script>__sveltekit_lab = {};\x3C/script><div data-mount>${inject_html('lake_page_reader_ssr_b64')}</div>`;
	const island = document.querySelector(ISLAND) as HTMLElement;
	bootDev();
	await expect.poll(() => island.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
	expect(island.hasAttribute('data-og-recovered')).toBe(false);
	expect(island.querySelector('[data-testid="branch"]')?.textContent).toBe('search');
});
