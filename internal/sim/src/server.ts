/**
 * A server of the world: a built SvelteKit app (its `.svelte-kit/output`), run in this process, the
 * way an adapter runs it: static files from `output/client` (and prerendered pages), everything else
 * through Kit's `Server.respond`, with ogygia's server hooks inside. Each build is loaded from its own
 * copy of the output, so two builds (an old and a new one, mid-deploy) and two instances of one
 * build each get their own module graph: their caches and stores are their own, as on two machines.
 *
 * Limits (internal/notes/dst.md): instances share this process's globals, so state ogygia pins to
 * `globalThis` (a few registries keyed by a `Symbol.for`) is shared between them; and every
 * instance's timers run on the one host platform, with the instance's skew read from its request
 * context.
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
}

export interface ServerInstance {
	readonly name: string;
	readonly build: Build;
	/** ms its wall clock is off. */
	readonly skew: number;
	handle(request: Request): Promise<Response>;
	/** Removes its copy of the build (its modules stay loaded in this process). */
	stop(): void;
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
	scratch: string,
	skew = 0
): Promise<ServerInstance> {
	const dir = join(scratch, `${process.pid}-${++started}-${build.id}-${name}`);
	rmSync(dir, { recursive: true, force: true });
	link_tree(join(build.output, 'server'), join(dir, 'server'));
	const files = files_of(build.output);
	const { Server } = (await native_import(pathToFileURL(join(dir, 'server', 'index.js')).href)) as {
		Server: new (manifest: unknown) => KitServer;
	};
	const { manifest } = (await native_import(
		pathToFileURL(join(dir, 'server', 'manifest.js')).href
	)) as {
		manifest: unknown;
	};
	const kit = new Server(manifest);
	await kit.init({ env: { ...process.env } as Record<string, string> });
	const instance: ServerInstance = {
		name,
		build,
		skew,
		handle: (request) =>
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
					? (files.pages.get(path === '/' ? '/index.html' : `${path}.html`) ??
						files.pages.get(join(path, 'index.html')))
					: undefined;
				if (page !== undefined)
					return new Response(head ? null : page.slice(), {
						headers: { 'content-type': TYPES['.html'] }
					});
				return kit.respond(request, { getClientAddress: () => '10.0.0.1', platform: {} });
			}),
		stop: () => rmSync(dir, { recursive: true, force: true })
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
