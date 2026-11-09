// THE DOCK'S SWITCH IN A BUILD (#239): turning devtools off takes the whole dock with it, in every
// order. A build of the devtools lab with the dock on (`OGYGIA_DEVTOOLS=1`, its own output dir:
// svelte.config.js `LAB_OUT`), served by adapter-node: there the dock is a lazy chunk behind the
// browser's switch (`?og-devtools=on`, `ogygia.devtools.on()` / `.off()`). Each test turns it off at
// another point (the dock open, only the launcher up, the dock's code still downloading) and checks
// nothing of it is left: no Alt+O listener, no observer on the document's head, no dock mounted into
// the detached root; turned on again, one dock runs.
//
//   pnpm --filter @ogygia/devtools e2e dock-switch
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import { test, check } from '@ogygia/tooling/e2e';
import { spawn_server, port, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const app = fileURLToPath(new URL('./app', import.meta.url));
const OUT = '.lab-dock';
const PORT = port(3106);
const base = `http://127.0.0.1:${PORT}`;
let server: SpawnedServer | undefined;

test.use({ baseURL: base });
test.beforeAll(async () => {
	rmSync(join(app, OUT), { recursive: true, force: true });
	const built = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], {
		cwd: app,
		env: { ...process.env, LAB_OUT: OUT, OGYGIA_DEVTOOLS: '1' },
		stdio: 'inherit'
	});
	if (built.status !== 0) throw new Error('the dock-on build of the devtools lab failed');
	server = await spawn_server({
		cmd: 'node',
		args: [join(OUT, 'build')],
		cwd: app,
		env: { PORT: String(PORT), HOST: '127.0.0.1', ORIGIN: base },
		url: `${base}/robots.txt`
	});
});
test.afterAll(async () => {
	await server?.kill();
	rmSync(join(app, OUT), { recursive: true, force: true });
});

interface Probe {
	/** Alt+O listeners on the window (the launcher's and the dock's are the ones reading altKey) */
	keys: number;
	/** MutationObservers watching the document's head (the dock moves its styles from there) */
	heads: number;
	/** the dock's page hook: there once a dock mounted */
	hook: boolean;
	hosts: number;
}
type ProbeWindow = typeof window & {
	__dock_probe(): Probe;
	ogygia: { devtools: { on(): string; off(): string } };
};

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const keys = new Set<unknown>();
		const proto = EventTarget.prototype;
		const add = proto.addEventListener;
		const remove = proto.removeEventListener;
		proto.addEventListener = function (
			this: EventTarget | undefined,
			type: string,
			fn: EventListenerOrEventListenerObject | null,
			opts?: boolean | AddEventListenerOptions
		) {
			const on = this ?? window;
			if (on === window && type === 'keydown' && fn && String(fn).includes('altKey')) {
				keys.add(fn);
				if (typeof opts === 'object') opts.signal?.addEventListener('abort', () => keys.delete(fn));
			}
			return add.call(on, type, fn, opts);
		};
		proto.removeEventListener = function (
			this: EventTarget | undefined,
			type: string,
			fn: EventListenerOrEventListenerObject | null,
			opts?: boolean | EventListenerOptions
		) {
			const on = this ?? window;
			if (on === window && type === 'keydown') keys.delete(fn);
			return remove.call(on, type, fn, opts);
		};
		const heads = new Set<MutationObserver>();
		const observe = MutationObserver.prototype.observe;
		const disconnect = MutationObserver.prototype.disconnect;
		MutationObserver.prototype.observe = function (target, options) {
			if (target === document.head) heads.add(this);
			return observe.call(this, target, options);
		};
		MutationObserver.prototype.disconnect = function () {
			heads.delete(this);
			return disconnect.call(this);
		};
		(window as unknown as { __dock_probe(): unknown }).__dock_probe = () => ({
			keys: keys.size,
			heads: heads.size,
			hook: typeof (window as { __ogygia_page?: unknown }).__ogygia_page === 'function',
			hosts: document.querySelectorAll('[data-ogygia-devtools-host]').length
		});
	});
});

const probe = (page: Page) => page.evaluate(() => (window as ProbeWindow).__dock_probe());
const off = (page: Page) => page.evaluate(() => (window as ProbeWindow).ogygia.devtools.off());
const on = (page: Page) => page.evaluate(() => (window as ProbeWindow).ogygia.devtools.on());
const alt_o = (page: Page) =>
	page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'o', altKey: true })));
const layout_saved = (page: Page) =>
	page.evaluate(() => localStorage.getItem('ogygia:devtools:layout:v4') !== null);

/** the lab page with devtools switched on in this browser: the launcher up, the dock not loaded */
async function launcher(page: Page): Promise<void> {
	await page.goto('/dt-lab?og-devtools=on', { waitUntil: 'load' });
	await page.locator('[data-og-panel-toggle]').waitFor({ timeout: 10_000 });
}

async function open_dock(page: Page): Promise<void> {
	await page.locator('[data-og-panel-toggle]').click();
	await page.locator('[data-og-win]').waitFor({ timeout: 10_000 });
}

/** Every script the page asks for from now on. */
function scripts(page: Page): string[] {
	const asked: string[] = [];
	page.on('request', (r) => r.resourceType() === 'script' && asked.push(r.url()));
	return asked;
}

test.describe('the dock in a build: turned off, nothing of it is left (#239)', () => {
	test('the dock open, then off: its listeners and observers go, and Alt+O does nothing', async ({
		page
	}) => {
		await launcher(page);
		await open_dock(page);
		const before = await probe(page);
		check('the open dock listens for Alt+O', before.keys === 1, JSON.stringify(before));
		await off(page);
		const after = await probe(page);
		check('no Alt+O listener is left', after.keys === 0, JSON.stringify(after));
		check('no observer is left on the head', after.heads === 0, JSON.stringify(after));
		check('the host is gone', after.hosts === 0, JSON.stringify(after));
		await alt_o(page);
		check('Alt+O after it saves no dock layout', !(await layout_saved(page)));
	});

	test('only the launcher up, then off: Alt+O loads no dock', async ({ page }) => {
		await launcher(page);
		await off(page);
		const asked = scripts(page);
		await alt_o(page);
		await page.waitForTimeout(1500);
		const after = await probe(page);
		check('no script is asked for', asked.length === 0, asked.join(', '));
		check('no dock mounted', !after.hook && after.keys === 0, JSON.stringify(after));
	});

	test('the dock open, then off, then on and open: one dock runs', async ({ page }) => {
		await launcher(page);
		await open_dock(page);
		await off(page);
		await on(page);
		await open_dock(page);
		const now = await probe(page);
		check('one Alt+O listener', now.keys === 1, JSON.stringify(now));
		check('one observer on the head', now.heads === 1, JSON.stringify(now));
		check('one host', now.hosts === 1, JSON.stringify(now));
	});

	test("off while the dock's code downloads: the dock never mounts", async ({ page }) => {
		await launcher(page);
		// hold every script asked for from here on: the dock's code
		let release!: () => void;
		const released = new Promise<void>((r) => (release = r));
		const held: Route[] = [];
		await page.route(
			(url) => url.pathname.endsWith('.js'),
			async (route) => {
				held.push(route);
				await released;
				await route.continue();
			}
		);
		await page.locator('[data-og-panel-toggle]').click();
		await test.expect.poll(() => held.length, { timeout: 10_000 }).toBeGreaterThan(0);
		await off(page);
		const done = page.waitForResponse((r) => held.some((h) => h.request().url() === r.url()));
		release();
		await done;
		await page.waitForTimeout(1000);
		const after = await probe(page);
		check('no dock mounted', !after.hook, JSON.stringify(after));
		check('no Alt+O listener is left', after.keys === 0, JSON.stringify(after));
		check('no observer is left on the head', after.heads === 0, JSON.stringify(after));
	});
});
