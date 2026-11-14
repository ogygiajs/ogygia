// DEV: an og.$ function a csr=false page hands an island through context revives on the dev server,
// as it does in a build (dollar-fn.spec.ts) (#1912).
//
//   pnpm exec playwright test dev-dollar-fn
//
// The defining module is the csr=false page: it never runs in the browser, so the island finds the
// function's factory only in the page's fn manifest. The dev server's manifest answered null, so
// the island's call threw `fmt is not a function`.
// Self-contained: boots the palaestra DEV server.
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { REPO as repo } from '@ogygia/tooling/e2e';
import { spawn_server, port, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const palaestra = fileURLToPath(new URL('..', import.meta.url));
const PORT = port(3083);
const base = `http://127.0.0.1:${PORT}`;

let srv: SpawnedServer | null = null;

test.describe('dev: an og.$ fn crosses context into an island', () => {
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
			url: `${base}/dollar-fn`,
			timeout_ms: 120_000
		});
	});

	test.afterAll(async () => {
		await srv?.kill();
	});

	test('fmt(100) with the bound capture (tax=0.19) → x119.00, with no page error', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await page.goto(`${base}/dollar-fn`);
		await expect(page.locator('ogygia-region[data-hydrated]')).toHaveCount(1, { timeout: 60_000 });
		await page.locator('[data-dollar-btn]').click();
		await expect(page.locator('[data-dollar-out]')).toHaveText('x119.00');
		expect(errors).toEqual([]);
	});
});
