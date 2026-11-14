/**
 * ONE OF JUMPSTART'S COMMITTED FIXTURE APPS (e2e/app, e2e/app-kit3, e2e/plain), built through its
 * normal `vite build` with or without `jumpstart()` (the `JUMPSTART*` switches its Vite config
 * reads), each build into its own directory, and served by `vite preview` or Vite's dev server.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { dedent } from '@ogygia/core/plugin/utils';

const E2E = import.meta.dirname;
/** A stable signing key, so a build and its server agree (region addresses are signed). */
const SECRET =
	process.env.OGYGIA_SECRET ?? '3f9a2b7c1e5d8046af62c93b1d7e4058a6c2f19b3e8d70425c9a1f6b8d3e07c4';
/** The per-response random mark (INVARIANTS RESPONSE-MARK): different on every response by design. */
const RESPONSE_MARK_G = /data-og-mark="[0-9a-f]+"/g;
/** A hole's signed address: its expiry and signature change with the clock. */
const HOLE_ADDRESS_G = /__ogygia__\?[^"]+/g;
const FILES_LOADED_RE = /files loaded: (\d+)/;
const HOLE_ADDRESS_RE = /__ogygia__\?[^"]+/;

/** One build: with `jumpstart()` or not, and its `external`. */
export interface Variant {
	jumpstart: boolean;
	external?: readonly string[];
	/** Rolldown's strictExecutionOrder on the server build (e2e/plain only: the canary). */
	strict?: boolean;
}

/** What a build printed, and where its server output is. */
export interface Built {
	ok: boolean;
	log: string;
	server: string;
}

/** A fixture app, its builds and one server at a time. */
export class Fixture {
	readonly dir: string;
	url = '';
	#server: ChildProcess | null = null;

	constructor(name: 'app' | 'app-kit3' | 'plain' | 'bench-app') {
		this.dir = path.join(E2E, name);
	}

	/** The Kit build directory of a variant. */
	static out(v: Variant): string {
		return v.jumpstart ? '.svelte-kit-jumpstart' : '.svelte-kit';
	}

	/** `vite build`, in a child process; stopped after `timeout` ms (then `ok` is false). */
	async build(v: Variant, timeout = 240_000): Promise<Built & { timed_out: boolean }> {
		const child = this.#vite(['build'], v);
		let log = '';
		child.stdout!.on('data', (d: Buffer) => (log += d.toString()));
		child.stderr!.on('data', (d: Buffer) => (log += d.toString()));
		let timed_out = false;
		const timer = setTimeout(() => {
			timed_out = true;
			child.kill('SIGKILL');
		}, timeout);
		const code = await new Promise<number | null>((r) => child.once('exit', r));
		clearTimeout(timer);
		return {
			ok: code === 0 && !timed_out,
			timed_out,
			log,
			server: path.join(this.dir, Fixture.out(v), 'output/server')
		};
	}

	/** Serves a variant's build with `vite preview`. */
	preview(v: Variant): Promise<this> {
		return this.#start(['preview'], v);
	}

	/** Vite's dev server. */
	dev(v: Variant): Promise<this> {
		return this.#start(['dev'], v);
	}

	/** The status and body of `pathname`. */
	async get(pathname: string): Promise<{ status: number; body: string }> {
		const res = await fetch(new URL(pathname, this.url));
		return { status: res.status, body: await res.text() };
	}

	/** The page as a comparison reads it: its status and body, the response mark, hole addresses
	 *  (random or clock-signed by design) and the server's own origin (its port) replaced, and each
	 *  hole's own answer appended. */
	async page(pathname: string): Promise<string> {
		const { status, body } = await this.get(pathname);
		const holes: string[] = [];
		for (const address of body.match(HOLE_ADDRESS_G) ?? [])
			holes.push((await this.get(`/${address.replaceAll('&amp;', '&')}`)).body);
		const same = body
			.replace(RESPONSE_MARK_G, 'data-og-mark=""')
			.replace(HOLE_ADDRESS_G, '__ogygia__?')
			.replaceAll(this.url, 'http://localhost');
		return [String(status), same, ...holes].join('\n----\n');
	}

	/** The first hole address in a page, or null. */
	static hole(body: string): string | null {
		return HOLE_ADDRESS_RE.exec(body)?.[0] ?? null;
	}

	async stop(): Promise<void> {
		const server = this.#server;
		this.#server = null;
		if (server && server.exitCode === null) {
			const exited = new Promise((r) => server.once('exit', r));
			server.kill();
			await exited;
		}
	}

	/** Every `.js` file under `dir`, relative, sorted. */
	static js_files(dir: string): string[] {
		if (!fs.existsSync(dir)) return [];
		return (fs.readdirSync(dir, { recursive: true }) as string[])
			.filter((f) => f.endsWith('.js'))
			.map((f) => f.split(path.sep).join('/'))
			.sort();
	}

	/** The `file:` URLs Node's ESM loader loads to import `module` in a fresh process. */
	static async files_loaded(module: string): Promise<number> {
		const script = dedent`
			import { registerHooks } from 'node:module';
			let files = 0;
			registerHooks({ load(url, context, next) { if (url.startsWith('file:')) files++; return next(url, context); } });
			await import(${JSON.stringify(new URL(`file://${module}`).href)});
			console.log(\`files loaded: \${files}\`);
		`;
		const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
			env: { ...process.env, NODE_OPTIONS: undefined },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let out = '';
		let err = '';
		child.stdout.on('data', (d: Buffer) => (out += d.toString()));
		child.stderr.on('data', (d: Buffer) => (err += d.toString()));
		const code = await new Promise<number | null>((r) => child.once('exit', r));
		if (code !== 0) throw new Error(`importing ${module} failed:\n${err}`);
		const counted = FILES_LOADED_RE.exec(out);
		if (!counted)
			throw new Error(dedent`
				importing ${module} printed no count:
				${out}
				${err}
			`);
		return Number(counted[1]);
	}

	#vite(args: string[], v: Variant): ChildProcess {
		const vite = path.join(this.dir, 'node_modules/vite/bin/vite.js');
		return spawn(process.execPath, [vite, ...args], {
			cwd: this.dir,
			env: {
				...process.env,
				NODE_ENV: undefined,
				OGYGIA_SECRET: SECRET,
				JUMPSTART: v.jumpstart ? '1' : '',
				JUMPSTART_EXTERNAL: (v.external ?? []).join(','),
				JUMPSTART_OUT: Fixture.out(v),
				JUMPSTART_STRICT: v.strict ? '1' : ''
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
	}

	async #start(args: string[], v: Variant): Promise<this> {
		await this.stop();
		const port = await Fixture.#free_port();
		this.url = `http://localhost:${port}`;
		const child = this.#vite([...args, '--port', String(port), '--strictPort'], v);
		let log = '';
		child.stdout!.on('data', (d: Buffer) => (log += d.toString()));
		child.stderr!.on('data', (d: Buffer) => (log += d.toString()));
		this.#server = child;
		for (let i = 0; i < 600; i++) {
			if (child.exitCode !== null) throw new Error(`the server exited:\n${log}`);
			if (
				await fetch(this.url).then(
					() => true,
					() => false
				)
			)
				return this;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error(`the server did not come up:\n${log}`);
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
}
