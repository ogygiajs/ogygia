/**
 * A server of the world: a built SvelteKit app (its `.svelte-kit/output`), run in this process, the
 * way an adapter runs it: static files from `output/client` (and prerendered pages), everything else
 * through Kit's `Server.respond`, with ogygia's server hooks inside. Each build is loaded from its own
 * copy of the output, so two builds (an old and a new one, mid-deploy) and two instances of one
 * build each get their own module graph: their caches and stores are their own, as on two machines.
 *
 * Each instance has its own `Symbol.for` registry (`own_symbols`), so what ogygia keeps on
 * `globalThis` under one is its own. Limits (internal/notes/dst.md): string-keyed globals are still
 * shared; and every instance's timers run on the one host platform, each in the context it was set
 * in (the instance's skew and symbols read from it).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
	existsSync,
	linkSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync
} from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Node's own `import()`: a built app is plain ESM, and a test runner's module transform (vitest's)
 *  must not load it a second, different way. */
const native_require = createRequire(import.meta.url);
const native_import = async (url: string): Promise<unknown> => native_require(fileURLToPath(url));

/** The server instance whose code is running now (for its clock skew), if any. */
export const current_server = new AsyncLocalStorage<ServerInstance>();

/** The instance whose code is loading or running now, by its registry's tag (its symbols). */
const registry_of = new AsyncLocalStorage<string>();

/**
 * EACH INSTANCE ITS OWN SYMBOL REGISTRY, as on its own machine: `Symbol.for(key)` in an instance's
 * code is that instance's symbol, so the slots ogygia keeps on `globalThis` under a `Symbol.for`
 * (its request context, signing key, caches, plugin hooks) are the instance's own. One registry
 * for all once let one instance's hooks answer for another's renders (a hole's `pv=` dropped on
 * one of two servers). Node's own keys (`nodejs.*`, `Symbol.*`) stay the process's. Returns the
 * undo.
 */
export function own_symbols(): () => void {
	const host_for = Symbol.for;
	const host_key_for = Symbol.keyFor;
	const tagged = (key: string): boolean => !key.startsWith('nodejs.') && !key.startsWith('Symbol.');
	Symbol.for = (key: string): symbol => {
		const tag = registry_of.getStore();
		key = String(key);
		return host_for(tag !== undefined && tagged(key) ? `${tag}\u0000${key}` : key);
	};
	Symbol.keyFor = (sym: symbol): string | undefined => {
		const key = host_key_for(sym);
		return key === undefined ? key : key.slice(key.indexOf('\u0000') + 1);
	};
	return () => {
		Symbol.for = host_for;
		Symbol.keyFor = host_key_for;
	};
}

/** The environment of the instance whose code is loading or running now. */
const env_of = new AsyncLocalStorage<Readonly<Record<string, string>>>();

/**
 * EACH INSTANCE ITS OWN `process.env`, as on its own machine: a key the instance's environment has
 * reads as its own (a federation peer checks a call's audience against its own `ORIGIN`), any
 * other the host's. Writes go to the host's. Returns the undo.
 */
export function own_env(): () => void {
	const host = process.env;
	const own = (key: string | symbol): string | undefined => {
		const env = env_of.getStore();
		return typeof key === 'string' && env !== undefined && Object.hasOwn(env, key)
			? env[key]
			: undefined;
	};
	process.env = new Proxy(host, {
		get: (target, key) => own(key) ?? Reflect.get(target, key),
		has: (target, key) => own(key) !== undefined || Reflect.has(target, key),
		ownKeys: (target) => [
			...new Set([...Reflect.ownKeys(target), ...Object.keys(env_of.getStore() ?? {})])
		],
		getOwnPropertyDescriptor: (target, key) => {
			const value = own(key);
			return value === undefined
				? Reflect.getOwnPropertyDescriptor(target, key)
				: { value, writable: true, enumerable: true, configurable: true };
		}
	});
	return () => {
		process.env = host;
	};
}

const TYPES: Record<string, string> = {
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.html': 'text/html; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain'
};

interface KitServer {
	init(options: {
		env: Record<string, string>;
		read?: (file: string) => ReadableStream;
	}): Promise<void>;
	respond(
		request: Request,
		options: { getClientAddress(): string; platform?: unknown }
	): Promise<Response>;
}

/** A build: one app's output, copied so each instance can load its own module graph. */
export interface Build {
	/** A name for the trace (`v1`, `v2`). */
	readonly id: string;
	/** The app's `.svelte-kit/output`. */
	readonly output: string;
	/** Its server's environment beside the host's (`$env/dynamic/private`): a federated app's keys
	 *  and its peers' origins. */
	readonly env?: Readonly<Record<string, string>>;
}

export interface ServerInstance {
	readonly name: string;
	readonly build: Build;
	/** Its own environment over the host's: the build's, and `ORIGIN` (its public origin, as an
	 *  adapter is told). What its code reads from `process.env` (`own_env`). */
	readonly env: Readonly<Record<string, string>>;
	/** ms its wall clock is off. */
	readonly skew: number;
	handle(request: Request): Promise<Response>;
	/** Whether its build has the static file at `path` (decoded). */
	serves(path: string): boolean;
	/** Removes its copy of the build (its modules stay loaded in this process). */
	stop(): void;
	/** Its machine moves so far, one line each (core's server rules keep its last lines), or '' in a
	 *  build without rules. */
	moves(): string;
}

/**
 * `from` mirrored at `to` with hard links: new paths (so Node loads each as a new module), the
 * same bytes on disk, in a few ms for a whole build.
 */
function link_tree(from: string, to: string): void {
	mkdirSync(to, { recursive: true });
	for (const e of readdirSync(from, { withFileTypes: true })) {
		const a = join(from, e.name);
		const b = join(to, e.name);
		if (e.isDirectory()) link_tree(a, b);
		else linkSync(a, b);
	}
}

let started = 0;

/**
 * Loads instance `name` of `build`, from a private copy of its output under `scratch`: a new copy
 * for every start, so a world never meets the module state of a world before it (one process runs
 * many seeds, and a seed must replay the same whether it runs first or fiftieth).
 */
export async function start_server(
	name: string,
	build: Build,
	origin: string,
	scratch: string,
	skew = 0
): Promise<ServerInstance> {
	const env = { ORIGIN: origin, ...build.env };
	const dir = join(scratch, `${process.pid}-${++started}-${build.id}-${name}`);
	rmSync(dir, { recursive: true, force: true });
	link_tree(join(build.output, 'server'), join(dir, 'server'));
	const files = files_of(build.output);
	// (its code loads, and later runs, with its own symbols: `own_symbols`)
	const tag = `sim-server-${started}`;
	const kit = await env_of.run(env, () =>
		registry_of.run(tag, async () => {
			const { Server } = (await native_import(
				pathToFileURL(join(dir, 'server', 'index.js')).href
			)) as {
				Server: new (manifest: unknown) => KitServer;
			};
			const { manifest } = (await native_import(
				pathToFileURL(join(dir, 'server', 'manifest.js')).href
			)) as {
				manifest: unknown;
			};
			const kit = new Server(manifest);
			await kit.init({ env: { ...process.env, ...env } as Record<string, string> });
			return kit;
		})
	);
	const instance: ServerInstance = {
		name,
		build,
		env,
		skew,
		handle: (request) =>
			env_of.run(env, () =>
				registry_of.run(tag, () =>
					current_server.run(instance, async () => {
						const url = new URL(request.url);
						const path = decodeURIComponent(url.pathname);
						// (a static host answers HEAD as it does GET, without the body: a page asks whether a
						// file is still there, runtime/entry-locations.ts's `is_gone`)
						const read = request.method === 'GET' || request.method === 'HEAD';
						const head = request.method === 'HEAD';
						const asset = read ? files.client.get(path) : undefined;
						if (asset !== undefined) {
							const immutable = path.includes('/immutable/');
							return new Response(head ? null : asset.slice(), {
								headers: {
									'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
									'cache-control': immutable
										? 'public, max-age=31536000, immutable'
										: 'public, max-age=0'
								}
							});
						}
						const page = read
							? (files.pages.get(path === '/' ? '/index.html' : path + '.html') ??
								files.pages.get(join(path, 'index.html')))
							: undefined;
						if (page !== undefined)
							return new Response(head ? null : page.slice(), {
								headers: { 'content-type': TYPES['.html'] }
							});
						return kit.respond(request, { getClientAddress: () => '10.0.0.1', platform: {} });
					})
				)
			),
		serves: (path) => files.client.has(path),
		stop: () => rmSync(dir, { recursive: true, force: true }),
		moves: () => {
			const read = (globalThis as Record<symbol, unknown>)[
				Symbol.for(`${tag}\u0000ogygia.server.moves`)
			];
			return typeof read === 'function' ? String(read()) : '';
		}
	};
	return instance;
}

/** A build's static files (`client`) and prerendered pages, by URL path, read once per process. */
interface Files {
	readonly client: Map<string, Uint8Array>;
	readonly pages: Map<string, Uint8Array>;
}

const FILES = new Map<string, Files>();

function files_of(output: string): Files {
	let f = FILES.get(output);
	if (f === undefined) {
		f = {
			client: read_tree(join(output, 'client')),
			pages: read_tree(join(output, 'prerendered', 'pages'))
		};
		FILES.set(output, f);
	}
	return f;
}

function read_tree(
	root: string,
	into = new Map<string, Uint8Array>(),
	at = ''
): Map<string, Uint8Array> {
	if (!existsSync(root)) return into;
	for (const e of readdirSync(join(root, at), { withFileTypes: true })) {
		const rel = `${at}/${e.name}`;
		if (e.isDirectory()) read_tree(root, into, rel);
		else if (statSync(join(root, rel)).isFile()) into.set(rel, readFileSync(join(root, rel)));
	}
	return into;
}
