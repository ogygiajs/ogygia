// KIT'S ENV, READ AHEAD OF ITS PAGE (KIT-PUBLIC-ENV, #2219): Kit's patched `$app/env/public` reads
// the env once, as it first runs, from whatever document is open. The runtime can run it before the
// page that carries the env is the open one: a prefetch warms the next page's islands while this
// page is open, and an island inside a region answer (a server hole, a region a remote call renders)
// runs on a page that asked for no env itself. Until #2219 those islands read an empty env and say
// kit_env_missing; they never throw. Each test reads its own copy of the island (its own query).
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { init } from '../../src/runtime/lazy-link.ts';
import { reset_load_scheduler } from '../../src/runtime/load-scheduler.ts';
import { is_warmed_module } from '../../src/runtime/island-warm.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';
import { region_fragment } from './_html.ts';
import { kit_env_build } from '../_stubs/server.kit-env.ts';

const real_fetch = window.fetch;
const ISLAND = '/test/browser/fixtures/reads-kit-env.ts';
const island = async (copy: string): Promise<Record<string, unknown>> =>
	(
		(await import(/* @vite-ignore */ `${ISLAND}?${copy}`)) as {
			env: Record<string, unknown>;
		}
	).env;

/** The env channel's text as this build's server writes it. */
const env_text = (env: Record<string, unknown>) => stringify({ build: kit_env_build, env });
/** A page as the server sends it: its runtime script and its env channel bear `mark`. */
const next_page = (copy: string, env: Record<string, unknown>, mark: string) =>
	`<!doctype html><html><head><script type="module" data-ogygia-runtime src="/_app/og-rt.js" data-og-mark="${mark}"></script><script type="application/ogygia-env" data-og-mark="${mark}">${env_text(env)}</script></head><body><ogygia-region wake="load" entry="${ISLAND}?${copy}"><p>next</p></ogygia-region></body></html>`;

let served = '';
let said: MockInstance<typeof console.warn>;
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
	said = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	window.fetch = real_fetch;
	vi.restoreAllMocks();
});

test('a prefetch from a page with no env channel: the island it warms reads an empty env and says kit_env_missing', async () => {
	served = next_page('prefetched', { PUBLIC_REGION: 'eu' }, 'b'.repeat(24));
	const nav = await import('../../src/runtime/router-nav.ts');
	await nav.fetch_page(new URL('/kit-env-next', location.href).href, undefined, 'prefetch');
	await expect.poll(() => is_warmed_module(`${ISLAND}?prefetched`), { timeout: 2_000 }).toBe(true);
	expect(await island('prefetched')).toEqual({});
	await expect.poll(() => said.mock.calls.flat().join(' ')).toContain('kit_env_missing');
});

test("a channel another build wrote (a federated peer's region on the host's page) reads as an empty env, and says kit_env_missing", async () => {
	const mark = 'c'.repeat(24);
	const page = document.createElement('template');
	page.innerHTML = `<script type="application/x-runtime-stand-in" data-ogygia-runtime data-og-mark="${mark}"></script><script type="application/ogygia-env" data-og-mark="${mark}">${stringify({ build: 'another-build', env: { PUBLIC_REGION: 'host' } })}</script>`;
	const placed = [...page.content.children];
	document.head.prepend(...placed);
	try {
		expect(await island('peer')).toEqual({});
		await expect.poll(() => said.mock.calls.flat().join(' ')).toContain('kit_env_missing');
	} finally {
		for (const el of placed) el.remove();
	}
});

test('an island inside a region answer, on a page with no env channel, reads an empty env and says kit_env_missing', async () => {
	const { frag } = region_fragment(
		`<script type="application/ogygia-env">${env_text({ PUBLIC_REGION: 'hole' })}</script><p>hole</p>`
	);
	expect(frag.querySelector('p')).not.toBeNull();
	expect(await island('answer')).toEqual({});
	await expect.poll(() => said.mock.calls.flat().join(' ')).toContain('kit_env_missing');
});
