// DEV recovery: a Vite dep re-optimization rotates the optimizer hash, so a tab loaded under the
// old hash dynamic-imports island deps that now 404 — every island fails on wake with
// `Failed to fetch dynamically imported module`, and under csr=false Kit's absent client can't
// receive Vite's full-reload. The runtime watchdog CONFIRMS it is staleness (the entry still serves
// on a plain fetch, only the `?import` transform 404s) and reloads the tab once, loop-guarded so a
// genuinely-broken entry never reloads forever.
//
// Simulated here by aborting every module load of the island (its import and the loader's retry)
// while letting the plain fetch (the watchdog's confirmation) succeed. Dev only — the prod build tree-shakes
// the watchdog out, so this must run against a real `vite dev` server.
//
//   pnpm exec playwright test dev-stale-dep-reload
import { fileURLToPath } from 'node:url';
import { test, expect, check, REPO as repo } from '@ogygia/tooling/e2e';
import { spawn_server, port, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const palaestra = fileURLToPath(new URL('..', import.meta.url));
const PORT = port(3089);
const base = `http://127.0.0.1:${PORT}`;

let srv: SpawnedServer | null = null;

test.describe('dev: a stale-dep entry-fetch failure recovers the tab', () => {
	test.beforeAll(async () => {
		srv = await spawn_server({
			cmd: 'pnpm',
			args: [
				'--dir',
				palaestra,
				'dev',
				'--port',
				String(PORT),
				'--strictPort',
				'--host',
				'127.0.0.1'
			],
			cwd: repo,
			url: `${base}/interaction`,
			timeout_ms: 120_000
		});
	});

	test.afterAll(() => srv?.kill());

	test('the watchdog reloads once when the entry serves but its import fails, then stops', async ({
		page
	}) => {
		test.setTimeout(120_000);
		// Count loads across reloads.
		await page.addInitScript(() => {
			try {
				const n = Number(sessionStorage.getItem('__og_loads') || '0') + 1;
				sessionStorage.setItem('__og_loads', String(n));
			} catch {
				/* ignore */
			}
		});
		// The stale graph: in the first document every MODULE LOAD of an island fails (its first import
		// and the loader's retry under a fresh URL alike: a stale tab's imports keep failing whatever the
		// island's URL), while a plain fetch of it (the watchdog's confirm) serves. A new document (the
		// reload) has the server's current graph, so from then on the island loads.
		let documents = 0;
		page.on('request', (req) => {
			if (req.resourceType() === 'document' && req.frame() === page.mainFrame()) documents++;
		});
		await page.route(/ogygia:region\/entry\//, (r) =>
			r.request().resourceType() !== 'fetch' && documents < 2 ? r.abort() : r.continue()
		);

		// The page's `wake: 'load'` island fails as the page loads, with no click: a click here could
		// land on either document (the watchdog may already have reloaded), and one on the new one
		// counted too (count 2 on a slow runner).
		await page.goto(`${base}/interaction`, { waitUntil: 'load' });
		// watchdog: confirm-fetch + one reload
		await expect.poll(() => documents, { timeout: 15_000 }).toBe(2);
		await page.waitForLoadState('load');
		// the reloaded page works: the island wakes and counts a click
		await page.locator('[data-i-btn]').click();
		await expect
			.poll(async () => (await page.locator('[data-i-count]').textContent())?.trim(), {
				timeout: 10_000
			})
			.toBe('1');

		const loads = await page.evaluate(() => {
			try {
				return Number(sessionStorage.getItem('__og_loads') || '0');
			} catch {
				return -1;
			}
		});
		check('reloaded exactly once (recovered), did not loop', loads === 2, `loads=${loads}`);
	});
});
