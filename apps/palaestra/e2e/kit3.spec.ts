// SVELTEKIT 3 — a real Kit 3 app (internal/repro-kit3) on the PACKED ogygia, built and in dev.
// Kit 3 broke ogygia four ways at once, each only visible in a Kit 3 app:
// - its remote `form()` imports `refreshAll` from the client module ogygia stands in for: every
//   production build failed (`MISSING_EXPORT`);
// - its generated client entry moved under `generated/{build,dev}/`, so the kit-page thread was never
//   appended and islands on csr=true pages never got Kit's page;
// - the thread imported `$app/stores`, which Kit 3 removed (subscribing throws);
// - its remote ARGUMENT encoding reads the app's transport from a module only Kit's boot fills;
// - its `$app/env/public` reads a dynamic variable from Kit's boot payload (`__sveltekit_dev` in dev,
//   `payload.env` in a build), which only Kit's boot fills.
// The app: a lake in a csr=false layout (islands + a hole inside) serving a csr=false page and a
// csr=true page; an island with a remote form and the query it refreshes; an island whose query
// argument is a custom transport type; an island reading `page`; an island reading a static and a
// dynamic public env var (dev also edits the dynamic one's default and reloads, and starts once with
// no dynamic variable, then gains its first and makes it static again); outside the lake, a
// page whose only region wakes on interaction and reads the dynamic var, opened straight and reached
// by the router from a page that carries no env.
//
// Standalone install (not a workspace member): a workspace link would resolve ogygia's own Kit 2 dev
// install next to the app's Kit 3. Usage: pnpm exec playwright test kit3
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, check, sleep, stamp_document, document_stamp } from '@ogygia/tooling/e2e';
import { pack_ogygia, use_packed } from '@ogygia/tooling/e2e/packed.ts';
import { spawn_server, port, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURE = join(REPO, 'internal', 'repro-kit3');
// outside the repo: nothing above the app may resolve a package for it (the repo root holds Kit 2)
const WORK = join(tmpdir(), 'ogygia-e2e-kit3');
const APP = join(WORK, 'app');
const BUILD_PORT = port(3091);
const DEV_PORT = port(3092);
const COPY_SKIP_RE = /node_modules|\.svelte-kit|(^|\/)build($|\/)/;
// a stable signing key, so the build and the server agree (CI sets its own)
const SECRET =
	process.env.OGYGIA_SECRET ?? '3f9a2b7c1e5d8046af62c93b1d7e4058a6c2f19b3e8d70425c9a1f6b8d3e07c4';
// adapter-node 6 takes the request's protocol from a header (default https): the test server is http
const PROTO = { 'x-forwarded-proto': 'http' };

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): boolean {
	return spawnSync(cmd, args, { stdio: 'inherit', ...opts }).status === 0;
}

/** Build + pack ogygia (and the core it re-exports), copy the fixture beside the tarballs, install it
 *  standalone (its own workspace root: @ogygia/tooling/e2e/packed.ts). */
function prepare(): void {
	expect(run('pnpm', ['run', 'build:lib'], { cwd: REPO }), 'ogygia build').toBe(true);
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });
	const packed = pack_ogygia(WORK);
	cpSync(FIXTURE, APP, { recursive: true, filter: (src) => !COPY_SKIP_RE.test(src) });
	use_packed(APP, packed);
	// pnpm exits non-zero on unapproved native build scripts though the install completes: check by presence
	run('pnpm', ['install', '--no-lockfile', '--config.confirmModulesPurge=false'], {
		cwd: APP,
		env: { ...process.env, CI: '1' }
	});
	for (const dep of ['ogygia', 'vite', '@sveltejs/kit'])
		expect(existsSync(join(APP, 'node_modules', dep)), `installed ${dep}`).toBe(true);
	const kit = JSON.parse(
		readFileSync(join(APP, 'node_modules/@sveltejs/kit/package.json'), 'utf8')
	);
	expect(kit.version.startsWith('3.'), `Kit 3 installed (got ${kit.version})`).toBe(true);
}

/** One page of the lake: every island hydrated, the hole filled, each island working. */
async function exercise(
	page: Page,
	base: string,
	path: string,
	kit_page: boolean,
	region_name = 'region from env'
) {
	const errs: string[] = [];
	page.on('pageerror', (e) => errs.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`);
	});
	await page.goto(base + path, { waitUntil: 'networkidle' });
	await sleep(500);
	const at = `${path}:`;
	check(
		`${at} every island in the lake hydrated`,
		(await page.locator('ogygia-region[data-hydrated]').count()) === 5
	);
	check(
		`${at} the kit-page thread is ${kit_page ? 'set' : 'absent'}`,
		(await page.evaluate(
			() => !!(globalThis as Record<symbol, unknown>)[Symbol.for('ogygia.kit-page')]
		)) === kit_page
	);
	check(`${at} the island reads this page`, (await page.textContent('[data-probe-path]')) === path);
	check(`${at} the hole filled`, (await page.locator('[data-hole-greeting]').count()) === 1);

	await page.click('[data-counter]');
	check(`${at} island interactive`, (await page.textContent('[data-counter]')) === 'count 1');
	check(
		`${at} an island that imports $app/env/public reads its value`,
		(await page.textContent('[data-public-env]')) === 'hello from env'
	);
	check(
		`${at} an island reads a dynamic public env var (static: false)`,
		(await page.textContent('[data-public-dynamic-env]')) === region_name
	);

	// a custom transport type as a remote ARGUMENT, re-sent from the browser
	check(
		`${at} custom-type query argument (SSR)`,
		(await page.textContent('[data-point-sum]')) === '5'
	);
	await page.click('[data-point-bump]');
	await expect.poll(() => page.textContent('[data-point-sum]')).toBe('6');

	// the remote form: submit → Kit 3's form calls refreshAll → the island's query refreshes, no reload
	const stamp = await stamp_document(page);
	const before = (await page.locator('[data-items] li').allTextContents()).length;
	const text = `item-${path.length}-${Date.now() % 1000}`;
	await page.fill('[data-item-input]', text);
	await page.click('[data-item-submit]');
	await expect.poll(() => page.locator('[data-items] li').allTextContents()).toContain(text);
	check(
		`${at} the form refreshed the query (one more item)`,
		(await page.locator('[data-items] li').count()) === before + 1
	);
	check(`${at} the submit did not reload the page`, (await document_stamp(page)) === stamp);

	if (kit_page) {
		await page.click('[data-kit-btn]');
		check(
			`${at} Kit's own client is alive next to the lake`,
			(await page.textContent('[data-kit-btn]')) === 'kit:1'
		);
	}
	check(`${at} no errors or warnings`, errs.length === 0, errs.slice(0, 3).join(' | '));
}

/** The env pages: /env's only region wakes on interaction and imports $app/env/public, read straight
 *  away and after a router navigation from /plain, a page that carries no env. */
async function env_pages(page: Page, base: string, region_name = 'region from env') {
	const errs: string[] = [];
	page.on('pageerror', (e) => errs.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`);
	});
	const read = async (at: string) => {
		await page.click('[data-env-click]');
		await expect
			.poll(() => page.textContent('[data-env-click-value]'), {
				message: `${at} the interaction region reads the dynamic public env var`,
				timeout: 10_000
			})
			.toBe(`read: ${region_name}`);
	};

	await page.goto(`${base}/env`, { waitUntil: 'networkidle' });
	await read('/env:');

	await page.goto(`${base}/plain`, { waitUntil: 'networkidle' });
	await page.click('[data-hello]');
	check('/plain: its island hydrated', (await page.textContent('[data-hello]')) === 'hello 1');
	const stamp = await stamp_document(page);
	await page.click('[data-to-env]');
	await page.waitForSelector('[data-page="env"]');
	check('/plain → /env: by the router (no reload)', (await document_stamp(page)) === stamp);
	await read('/plain → /env:');
	check('env pages: no errors or warnings', errs.length === 0, errs.slice(0, 3).join(' | '));
}

/** The app's `vite dev` on DEV_PORT. */
function spawn_dev(base: string): Promise<SpawnedServer> {
	return spawn_server({
		cmd: 'node',
		args: [
			'node_modules/vite/bin/vite.js',
			'dev',
			'--host',
			'127.0.0.1',
			'--port',
			String(DEV_PORT),
			'--strictPort'
		],
		cwd: APP,
		env: { OGYGIA_SECRET: SECRET },
		url: `${base}/`,
		timeout_ms: 120_000
	});
}

/** The text of `selector` on a fresh load of `url`. */
async function fresh_text(
	context: BrowserContext,
	url: string,
	selector: string
): Promise<string | null> {
	const fresh = await context.newPage();
	await fresh.goto(url, { waitUntil: 'networkidle' });
	const text = await fresh.textContent(selector);
	await fresh.close();
	return text;
}

test.describe('SvelteKit 3: build + dev on the packed ogygia (self-building fixture)', () => {
	test.describe.configure({ mode: 'serial' });
	test.beforeAll(() => {
		test.setTimeout(10 * 60_000);
		prepare();
	});

	test('production build: builds, islands hydrate on csr=false and csr=true pages, remote form refreshes', async ({
		browser
	}) => {
		test.setTimeout(5 * 60_000);
		const env = { ...process.env, OGYGIA_SECRET: SECRET, OGYGIA_RULES: '1' };
		expect(run('pnpm', ['run', 'build'], { cwd: APP, env }), 'Kit 3 production build').toBe(true);
		const base = `http://127.0.0.1:${BUILD_PORT}`;
		let srv: SpawnedServer | undefined;
		try {
			srv = await spawn_server({
				cmd: 'node',
				args: ['build/index.js'],
				cwd: APP,
				env: {
					PORT: String(BUILD_PORT),
					HOST: '127.0.0.1',
					PROTOCOL_HEADER: 'x-forwarded-proto',
					OGYGIA_SECRET: SECRET
				},
				url: `${base}/`
			});
			const context = await browser.newContext({ extraHTTPHeaders: PROTO });
			await exercise(await context.newPage(), base, '/', false);
			await exercise(await context.newPage(), base, '/kit', true);
			await env_pages(await context.newPage(), base);
			await context.close();
		} finally {
			await srv?.kill();
		}
	});

	test("production build: a prerendered csr=false page's regions read the deployed server's dynamic public env, as Kit's prerendered csr=true page does", async ({
		browser
	}) => {
		test.setTimeout(5 * 60_000);
		const base = `http://127.0.0.1:${BUILD_PORT}`;
		const deployed = 'read: region deployed';
		const top = `top: region deployed, ${deployed}`;
		let srv: SpawnedServer | undefined;
		try {
			srv = await spawn_server({
				cmd: 'node',
				args: ['build/index.js'],
				cwd: APP,
				env: {
					PORT: String(BUILD_PORT),
					HOST: '127.0.0.1',
					PROTOCOL_HEADER: 'x-forwarded-proto',
					OGYGIA_SECRET: SECRET,
					PUBLIC_REGION_NAME: 'region deployed'
				},
				url: `${base}/`
			});
			const context = await browser.newContext({ extraHTTPHeaders: PROTO });
			const errs: string[] = [];
			const fresh = async () => {
				const page = await context.newPage();
				page.on('pageerror', (e) => errs.push(e.message));
				page.on('console', (m) => {
					if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`);
				});
				return page;
			};
			const shows = async (page: Page, at: string, name: string, value: string) => {
				await page.waitForSelector('ogygia-region[data-hydrated]');
				await page.click(`[data-${name}]`);
				await expect
					.poll(() => page.textContent(`[data-${name}-value]`), {
						message: `${at} ${name} reads the deployed value`,
						timeout: 10_000
					})
					.toBe(value);
			};

			const kit = await fresh();
			await kit.goto(`${base}/fixed-kit`, { waitUntil: 'networkidle' });
			await kit.click('[data-env-kit]');
			expect(await kit.textContent('[data-env-kit-value]'), "Kit's own page").toBe(deployed);

			const opened = await fresh();
			await opened.goto(`${base}/fixed`, { waitUntil: 'networkidle' });
			await shows(opened, '/fixed, read as the module runs:', 'env-load', top);
			await shows(opened, '/fixed, on interaction:', 'env-click', deployed);

			const held = await fresh();
			let let_env_through = () => {};
			const gate = new Promise<void>((resolve) => (let_env_through = resolve));
			await held.route('**/_app/env.js', async (route) => {
				await gate;
				await route.continue();
			});
			await held.goto(`${base}/fixed`);
			await held.hover('[data-env-click]');
			await sleep(1000);
			expect(
				await held.locator('ogygia-region[data-hydrated]').count(),
				'no region runs before the env it reads is in'
			).toBe(0);
			let_env_through();
			await shows(held, '/fixed, the env late:', 'env-load', top);
			await shows(held, '/fixed, the env late, on interaction:', 'env-click', deployed);

			for (const hover of [false, true]) {
				const routed = await fresh();
				await routed.goto(`${base}/plain`, { waitUntil: 'networkidle' });
				const stamp = await stamp_document(routed);
				if (hover) {
					await routed.hover('[data-to-fixed]');
					await sleep(1000);
				}
				await routed.click('[data-to-fixed]');
				await routed.waitForSelector('[data-page="fixed"]');
				const at = `/plain → /fixed${hover ? ', hovered first' : ''}:`;
				check(`${at} by the router (no reload)`, (await document_stamp(routed)) === stamp);
				await shows(routed, at, 'env-load', top);
				await shows(routed, at, 'env-click', deployed);
			}

			const plain = await fresh();
			let asked = 0;
			await plain.route('**/_app/env.js', (route) => (asked++, route.continue()));
			await plain.goto(`${base}/plain`, { waitUntil: 'networkidle' });
			await plain.goto(`${base}/env`, { waitUntil: 'networkidle' });
			expect(asked, 'a page that is not prerendered asks for no env module').toBe(0);
			check('no errors or warnings', errs.length === 0, errs.slice(0, 3).join(' | '));

			const dropped = await context.newPage();
			const said: string[] = [];
			dropped.on('console', (m) => said.push(m.text()));
			await dropped.route('**/_app/env.js*', (route) => route.abort());
			await dropped.goto(`${base}/fixed`);
			await dropped.waitForSelector('ogygia-region[data-hydrated]');
			await expect.poll(() => said.join(' | ')).toContain('kit_env_missing');
			await dropped.click('[data-env-load]');
			expect(
				await dropped.textContent('[data-env-load-value]'),
				'an env that never comes is said, and the value of the build never stands in for it'
			).toBe('top: undefined, read: undefined');
			await context.close();
		} finally {
			await srv?.kill();
		}
	});

	test('dev: islands hydrate on csr=false and csr=true pages, remote form refreshes', async ({
		browser
	}) => {
		test.setTimeout(5 * 60_000);
		const base = `http://127.0.0.1:${DEV_PORT}`;
		let srv: SpawnedServer | undefined;
		try {
			srv = await spawn_dev(base);
			// warm both pages first: dev discovers island deps on first render (one re-optimize)
			await fetch(`${base}/`);
			await fetch(`${base}/kit`);
			await fetch(`${base}/env`);
			await fetch(`${base}/plain`);
			await sleep(1500);
			const context = await browser.newContext();
			await exercise(await context.newPage(), base, '/', false);
			await exercise(await context.newPage(), base, '/kit', true);
			await env_pages(await context.newPage(), base);

			// a dynamic variable's default edited while dev runs: the next load reads the new value
			const env_file = join(APP, 'src/env.js');
			const env_source = readFileSync(env_file, 'utf8');
			try {
				writeFileSync(env_file, env_source.replace("'region from env'", "'region edited'"));
				await expect
					.poll(() => fresh_text(context, `${base}/`, '[data-public-dynamic-env]'), {
						timeout: 20_000
					})
					.toBe('region edited');
				await exercise(await context.newPage(), base, '/', false, 'region edited');
			} finally {
				writeFileSync(env_file, env_source);
			}
			await context.close();
		} finally {
			await srv?.kill();
		}
	});

	test('dev: an app started with no dynamic public variable reads its first one once it is added, and its static value once it is static again, with no warning', async ({
		browser
	}) => {
		test.setTimeout(5 * 60_000);
		const base = `http://127.0.0.1:${DEV_PORT}`;
		const env_file = join(APP, 'src/env.js');
		const env_source = readFileSync(env_file, 'utf8');
		const dynamic = "static: false,\n\t\tschema: (value) => value ?? 'region from env'";
		const static_only = "static: true,\n\t\tschema: (value) => value ?? 'region static'";
		expect(env_source.includes(dynamic), 'the fixture declares PUBLIC_REGION_NAME dynamic').toBe(
			true
		);
		let srv: SpawnedServer | undefined;
		try {
			writeFileSync(env_file, env_source.replace(dynamic, static_only));
			srv = await spawn_dev(base);
			await fetch(`${base}/`);
			await sleep(1500);
			const context = await browser.newContext();
			await expect
				.poll(() => fresh_text(context, `${base}/`, '[data-public-dynamic-env]'), {
					timeout: 20_000
				})
				.toBe('region static');

			writeFileSync(env_file, env_source);
			await expect
				.poll(() => fresh_text(context, `${base}/`, '[data-public-dynamic-env]'), {
					message: 'the first dynamic public variable reads its value after a reload',
					timeout: 20_000
				})
				.toBe('region from env');
			await exercise(await context.newPage(), base, '/', false);

			// and back: the variable made static again while dev runs reads its static value
			writeFileSync(env_file, env_source.replace(dynamic, static_only));
			await expect
				.poll(() => fresh_text(context, `${base}/`, '[data-public-dynamic-env]'), {
					message: 'the variable made static again reads its static value after a reload',
					timeout: 20_000
				})
				.toBe('region static');
			await exercise(await context.newPage(), base, '/', false, 'region static');
			await context.close();
		} finally {
			writeFileSync(env_file, env_source);
			await srv?.kill();
		}
	});
});
