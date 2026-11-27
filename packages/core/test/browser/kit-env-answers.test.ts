// KIT'S ENV, READ AHEAD OF ITS PAGE (KIT-PUBLIC-ENV): Kit's patched `$app/env/public` reads the env
// once, as it first runs, from whatever document is open. The runtime can run it before the page
// that carries the env is the open one: a prefetch warms the next page's islands while this page is
// open, and an island inside a region answer (a server hole, a region a remote call renders) runs on
// a page that asked for no env itself. Either way the module reads the env the server sent with the
// answer that brought the island. Module state the tests share: each test reads its own copy of the
// island (its own query) and its own value.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { init } from '../../src/runtime/lazy-link.ts';
import { reset_load_scheduler } from '../../src/runtime/load-scheduler.ts';
import { is_warmed_module } from '../../src/runtime/island-warm.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';
import { region_fragment } from './_html.ts';

const real_fetch = window.fetch;
const ISLAND = '/test/browser/fixtures/reads-kit-env.ts';
const island = async (copy: string): Promise<Record<string, unknown>> =>
	(
		(await import(/* @vite-ignore */ `${ISLAND}?${copy}`)) as {
			env: Record<string, unknown>;
		}
	).env;

/** A page as the server sends it: its runtime script bears `mark`, its env channel `channel_mark`. */
const next_page = (copy: string, env: object, mark: string, channel_mark = mark) =>
	`<!doctype html><html><head><script type="module" data-ogygia-runtime src="/_app/og-rt.js" data-og-mark="${mark}"></script><script type="application/ogygia-env" data-og-mark="${channel_mark}">${stringify(env)}</script></head><body><ogygia-region wake="load" entry="${ISLAND}?${copy}"><p>next</p></ogygia-region></body></html>`;

let served = '';
beforeEach(() => {
	reset_load_scheduler();
	reset_document_painted();
	init(link_boot());
	window.fetch = async () =>
		new Response(served, {
			status: 200,
			headers: {
				'content-type': 'text/html',
				'cache-control': 'private, max-age=60'
			}
		});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	window.fetch = real_fetch;
	vi.restoreAllMocks();
});

test("a prefetch from a page with no env channel: the island it warms reads the prefetched page's Kit env", async () => {
	served = next_page('prefetched', { PUBLIC_REGION: 'eu' }, 'b'.repeat(24));
	const nav = await import('../../src/runtime/router-nav.ts');
	await nav.fetch_page(new URL('/kit-env-next', location.href).href, undefined, 'prefetch');
	await expect.poll(() => is_warmed_module(`${ISLAND}?prefetched`), { timeout: 2_000 }).toBe(true);
	expect(await island('prefetched')).toEqual({ PUBLIC_REGION: 'eu' });
});

test("a prefetched page's env channel that does not bear that page's mark is never the env", async () => {
	served = next_page('forged', { PUBLIC_REGION: 'forged' }, 'c'.repeat(24), 'd'.repeat(24));
	const nav = await import('../../src/runtime/router-nav.ts');
	await nav.fetch_page(new URL('/kit-env-forged', location.href).href, undefined, 'prefetch');
	await expect.poll(() => is_warmed_module(`${ISLAND}?forged`), { timeout: 2_000 }).toBe(true);
	expect((await island('forged')).PUBLIC_REGION).not.toBe('forged');
});

test("a region answer's env channel is what an island inside it reads, on a page that has none", async () => {
	const { frag } = region_fragment(
		`<script type="application/ogygia-env">${stringify({ PUBLIC_REGION: 'hole' })}</script><p>hole</p>`
	);
	expect(frag.querySelector('script[type="application/ogygia-env"]')).toBeNull();
	expect(await island('answer')).toEqual({ PUBLIC_REGION: 'hole' });
});
