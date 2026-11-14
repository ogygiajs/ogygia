/**
 * A REAL SVELTEKIT APP FOR THE KIT CANARIES (#1723). The app in `_kit-app/` is copied to a temporary
 * directory whose `node_modules` holds one installed Kit and the Svelte, Vite and Svelte plugin that
 * Kit was installed with, then served by Kit's own Vite plugin in dev, or built and previewed. The
 * canaries ask the running app what Kit does, so a Kit refactor that only moves code stays green.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { dedent } from '../../src/contract/dedent.ts';

const FIXTURE = path.join(import.meta.dirname, '_kit-app');
const CORE_SRC = path.join(import.meta.dirname, '../../src');

/** How a canary app is served: Kit's dev server, or a production build behind `vite preview`. */
export type KitMode = 'dev' | 'build';

/** How the app is set up. */
export interface KitAppOptions {
	/** `app`: a csr=true page (`/`) and a csr=false page (`/server`). `all-csr-false`: one
	 *  csr=false page under a csr=false root layout, so Kit skips its client build. */
	routes?: 'app' | 'all-csr-false';
	/** Kit's `output.bundleStrategy`. */
	bundle?: 'split' | 'single' | 'inline';
	/** Kit's `inlineStyleThreshold`. */
	inline_style_threshold?: number;
}

/** The `kit.outDir` and `kit.appDir` every canary app sets, so a canary sees Kit honour both. */
export const OUT_DIR = '.kit-out';
export const APP_DIR = '_canary';

/** A deferred module script that stands for ogygia's runtime: it loads slowly, then sets
 *  `window.__canary_runtime`. Put it in a page with {@link KitApp.start_in}'s `rewrite`. */
export const SLOW_RUNTIME = `<script type="module" src="/__canary_runtime.js"></script>`;

/** What the app's client hooks saw as Kit started (`_kit-app/src/hooks.client.ts`). */
export interface KitStart {
	/** Whether {@link SLOW_RUNTIME} had run when Kit ran the app's `init` hook (`false` when the
	 *  page has none, or `init` never ran). */
	runtime_before_init: boolean;
	/** Whether Kit ran the app's `init` hook at all. */
	init_ran: boolean;
	/** `page.status` when Kit ran `init`. */
	status_at_init: number;
	/** Every `page.status` an effect saw, in order. */
	status_seen: number[];
}

/** One canary app, booted against one installed Kit. */
export class KitApp {
	readonly dir: string;
	readonly major: number;
	url = '';
	readonly #mode: KitMode;
	#server: ChildProcess | null = null;
	#log = '';

	constructor(kit_root: string, mode: KitMode, options: KitAppOptions = {}) {
		this.#mode = mode;
		this.dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ogygia-kit-canary-')));
		this.major = Number.parseInt(
			(
				JSON.parse(fs.readFileSync(path.join(kit_root, 'package.json'), 'utf8')) as {
					version: string;
				}
			).version,
			10
		);
		const modules = path.join(this.dir, 'node_modules');
		fs.mkdirSync(path.join(modules, '@sveltejs'), { recursive: true });
		fs.symlinkSync(kit_root, path.join(modules, '@sveltejs/kit'), 'dir');
		for (const dep of ['svelte', 'vite', '@sveltejs/vite-plugin-svelte'])
			fs.symlinkSync(KitApp.#package_dir(kit_root, dep), path.join(modules, dep), 'dir');
		fs.cpSync(path.join(FIXTURE, 'src'), path.join(this.dir, 'src'), { recursive: true });
		fs.writeFileSync(
			path.join(this.dir, 'package.json'),
			JSON.stringify({ name: 'kit-canary', private: true, type: 'module' })
		);
		fs.writeFileSync(
			path.join(this.dir, 'src/lib/ogygia.ts'),
			dedent`
				export { KitRequestStore } from ${JSON.stringify(path.join(CORE_SRC, 'server/kit-request-store.ts'))};
				export { collect_remote_seed } from ${JSON.stringify(path.join(CORE_SRC, 'server/remote-seed-gate.ts'))};
			`
		);
		const kit = {
			files: { routes: options.routes === 'all-csr-false' ? 'src/all-csr-false' : 'src/pages' },
			outDir: OUT_DIR,
			appDir: APP_DIR,
			inlineStyleThreshold: options.inline_style_threshold ?? 0,
			output: { bundleStrategy: options.bundle ?? 'split' },
			experimental: { remoteFunctions: true }
		};
		const compilerOptions = { experimental: { async: true } };
		if (this.major < 3)
			fs.writeFileSync(
				path.join(this.dir, 'svelte.config.js'),
				`export default ${JSON.stringify({ kit, compilerOptions })};`
			);
		const plugin =
			this.major < 3 ? '' : JSON.stringify({ ...kit, alias: { $lib: 'src/lib' }, compilerOptions });
		fs.writeFileSync(
			path.join(this.dir, 'vite.config.js'),
			dedent`
				import { sveltekit } from '@sveltejs/kit/vite';
				export default { plugins: [sveltekit(${plugin})], resolve: { dedupe: ['@sveltejs/kit', 'svelte'] }, logLevel: 'warn' };
			`
		);
	}

	/** Re-exports `name` from `file` in the app's `$lib/ogygia`, for its hooks to call. */
	export_from(name: string, file: string): this {
		fs.appendFileSync(
			path.join(this.dir, 'src/lib/ogygia.ts'),
			`\nexport { ${name} } from ${JSON.stringify(file)};`
		);
		return this;
	}

	/** The directory the build wrote (`kit.outDir`). */
	get out_dir(): string {
		return path.join(this.dir, OUT_DIR);
	}

	/** What the app's Vite printed, for a failure message. */
	get log(): string {
		return this.#log;
	}

	/** Runs `script` (an ES module) with Node in the app's directory, as Vite runs its config there;
	 *  what it prints. */
	async node(script: string): Promise<string> {
		const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
			cwd: this.dir,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let out = '';
		let err = '';
		child.stdout.on('data', (d: Buffer) => (out += d.toString()));
		child.stderr.on('data', (d: Buffer) => (err += d.toString()));
		const code = await new Promise<number | null>((r) => child.once('exit', r));
		if (code !== 0) throw new Error(`the script failed (${code}):\n${err}`);
		return out;
	}

	/** Builds the app when it is served from a build, then serves it. */
	async start(): Promise<this> {
		if (this.#mode === 'build') await this.#vite(['build']);
		const port = await KitApp.#free_port();
		this.url = `http://localhost:${port}`;
		this.#server = this.#spawn([
			this.#mode === 'dev' ? 'dev' : 'preview',
			'--port',
			String(port),
			'--strictPort'
		]);
		await this.#until_up();
		return this;
	}

	/** The body of `pathname`, GET from the running app. */
	async text(pathname: string): Promise<string> {
		return (await fetch(new URL(pathname, this.url))).text();
	}

	/** `pathname` with `?probe`: its HTML, and what the app's server hooks read of Kit's request
	 *  store while it rendered (`_kit-app/src/hooks.server.ts`). */
	async probe(pathname: string): Promise<{ html: string; probe: Record<string, unknown> }> {
		return (await fetch(new URL(`${pathname}?probe`, this.url))).json() as Promise<{
			html: string;
			probe: Record<string, unknown>;
		}>;
	}

	/** Opens `pathname` in `browser`, its HTML first passed through `rewrite`, and waits until Kit
	 *  applied the page's status (or ten seconds passed). */
	async start_in(
		browser: Browser,
		pathname: string,
		rewrite: (html: string) => string = (html) => html
	): Promise<KitStart> {
		const page = await browser.newPage();
		try {
			await page.route(new URL('/__canary_runtime.js', this.url).href, async (route) => {
				await new Promise((r) => setTimeout(r, 500));
				await route.fulfill({
					contentType: 'text/javascript',
					body: 'window.__canary_runtime = true;'
				});
			});
			await page.route(new URL(pathname, this.url).href, async (route) => {
				const response = await route.fetch();
				await route.fulfill({ response, body: rewrite(await response.text()) });
			});
			await page.goto(new URL(pathname, this.url).href);
			await page
				.waitForFunction(
					() =>
						(window as { __canary_status?: { seen: number[] } }).__canary_status?.seen.some(
							(s) => s !== -1
						),
					undefined,
					{ timeout: 10_000 }
				)
				.catch(() => undefined);
			return await page.evaluate(() => {
				const w = window as {
					__canary_status?: { at_init: number; seen: number[] };
					__canary_runtime_before_init?: boolean;
				};
				return {
					runtime_before_init: w.__canary_runtime_before_init === true,
					init_ran: w.__canary_status !== undefined,
					status_at_init: w.__canary_status?.at_init ?? Number.NaN,
					status_seen: [...(w.__canary_status?.seen ?? [])]
				};
			});
		} finally {
			await page.close();
		}
	}

	/** Stops the server and removes the app. */
	async stop(): Promise<void> {
		const server = this.#server;
		this.#server = null;
		if (server && server.exitCode === null) {
			const exited = new Promise((r) => server.once('exit', r));
			server.kill();
			await exited;
		}
		fs.rmSync(this.dir, { recursive: true, force: true });
	}

	/** A headless Chromium for {@link KitApp.start_in}. */
	static browser(): Promise<Browser> {
		return chromium.launch();
	}

	/** Where `name` resolves from `from`, by Node's `node_modules` walk (a package need not export
	 *  its package.json). */
	static #package_dir(from: string, name: string): string {
		for (let dir = fs.realpathSync(from); ; dir = path.dirname(dir)) {
			const at = path.join(dir, 'node_modules', name);
			if (fs.existsSync(path.join(at, 'package.json'))) return at;
			if (path.dirname(dir) === dir) throw new Error(`${name} does not resolve from ${from}`);
		}
	}

	static #free_port(): Promise<number> {
		return new Promise((resolve, reject) => {
			const server = net.createServer();
			server.once('error', reject);
			server.listen(0, () => {
				const { port } = server.address() as net.AddressInfo;
				server.close(() => resolve(port));
			});
		});
	}

	#spawn(args: string[]): ChildProcess {
		const vite = path.join(this.dir, 'node_modules/vite/bin/vite.js');
		const child = spawn(process.execPath, [vite, ...args], {
			cwd: this.dir,
			env: { ...process.env, NODE_ENV: undefined },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		child.stdout!.on('data', (d: Buffer) => (this.#log += d.toString()));
		child.stderr!.on('data', (d: Buffer) => (this.#log += d.toString()));
		return child;
	}

	async #vite(args: string[]): Promise<void> {
		const child = this.#spawn(args);
		const code = await new Promise<number | null>((r) => child.once('exit', r));
		if (code !== 0) throw new Error(`vite ${args.join(' ')} failed (${code}):\n${this.#log}`);
	}

	async #until_up(): Promise<void> {
		for (let i = 0; i < 300; i++) {
			if (this.#server?.exitCode !== null)
				throw new Error(`the canary app's server exited:\n${this.#log}`);
			const up = await fetch(this.url).then(
				() => true,
				() => false
			);
			if (up) return;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error(`the canary app's server did not come up:\n${this.#log}`);
	}
}
