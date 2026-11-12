/**
 * A simulated tab's JavaScript modules, run by V8 itself. happy-dom compiles modules with its own
 * regex-based compiler, which turns an import into a copy instead of a live binding (Svelte reads
 * `component_context` across chunks live: with copies, islands fail to hydrate) and misses
 * `import.meta` after `return` or `?`. So every module of a simulated document is a
 * `vm.SourceTextModule` in the window's own context: real parsing, real live bindings, real
 * `import.meta`, one instance per URL per document. Its source comes over the simulated network
 * (the window's fetch).
 *
 * happy-dom keeps doing the rest (script elements, the order they run in, events): only its
 * compile step is replaced, by `use_v8_modules()`, for this process only (the sim's). A compiled
 * module answers happy-dom with no imports of its own and an `execute` that loads the module
 * through V8 and hands its namespace back as live getters.
 *
 * Needs `node --experimental-vm-modules` (`pnpm sim` passes it).
 */
import vm from 'node:vm';
import Module from 'happy-dom/lib/module/ECMAScriptModule.js';
import Compiler from 'happy-dom/lib/module/ECMAScriptModuleCompiler.js';

type Window = object & { fetch(url: string): Promise<Response>; location: { href: string } };

interface Loader {
	load(url: string, code?: string): Promise<vm.Module>;
	/** Puts a module whose source has arrived into the map, unrun (a `modulepreload`). */
	prime(url: string, code: string): void;
}

const LOADER = Symbol('ogygia.sim.modules');

/** The window's module loader (one per document: modules are per document, as in a browser). */
function loader_of(window: Window): Loader {
	const w = window as Window & { [LOADER]?: Loader };
	return (w[LOADER] ??= make_loader(window));
}

function make_loader(window: Window): Loader {
	const modules = new Map<string, Promise<vm.Module>>();
	const context = window as unknown as vm.Context;
	const make = (url: string, code: string): vm.SourceTextModule =>
		new vm.SourceTextModule(code, {
			identifier: url,
			context,
			initializeImportMeta(meta) {
				meta.url = url;
				(meta as { resolve?: (s: string) => string }).resolve = (s) => new URL(s, url).href;
			},
			importModuleDynamically: (async (specifier: string) => {
				const href = new URL(specifier, url).href;
				try {
					return await ready(await load(href));
				} catch (error) {
					// a download anywhere in its graph failed: the browser names the module asked for,
					// not the dependency (Chromium: "Failed to fetch dynamically imported module: <url>")
					if (!unfetched.has(error as object)) throw error;
					throw new (window as unknown as { TypeError: typeof TypeError }).TypeError(
						`Failed to fetch dynamically imported module: ${href}`
					);
				}
			}) as never
		});
	/** Errors of a module's download (not of its parse or its run). */
	const unfetched = new WeakSet<object>();
	const fetch_code = async (url: string): Promise<string> => {
		try {
			const r = await window.fetch(url);
			if (!r.ok) throw new TypeError(`${url}: status ${r.status}`);
			return await r.text();
		} catch (error) {
			if (typeof error === 'object' && error !== null) unfetched.add(error);
			throw error;
		}
	};
	const load = (url: string, code?: string): Promise<vm.Module> => {
		let m = modules.get(url);
		if (m === undefined) {
			m = (code !== undefined ? Promise.resolve(code) : fetch_code(url)).then((c) => make(url, c));
			// (a module that fails to load or parse fails its importers, who report it as a page
			// does; the cached promise itself is not an unhandled rejection of the host)
			m.catch(() => {});
			modules.set(url, m);
		}
		return m;
	};
	// (a module that already threw as it ran fails every graph that imports it with that error, as
	// in a browser; V8's linker would refuse it with an error of its own)
	const linker = async (specifier: string, referrer: vm.Module): Promise<vm.Module> => {
		const m = await load(new URL(specifier, referrer.identifier).href);
		if (m.status === 'errored') throw m.error;
		return m;
	};
	// one link and one evaluation per module, however many importers ask at once (a second asker
	// while the first links would find it neither unlinked nor linked)
	const readied = new WeakMap<vm.Module, Promise<vm.Module>>();
	// and one graph linked at a time: V8 cannot link two graphs that share a module at once
	let linking: Promise<unknown> = Promise.resolve();
	const ready = (m: vm.Module): Promise<vm.Module> => {
		let r = readied.get(m);
		if (r === undefined) {
			r = (async () => {
				if (m.status === 'unlinked') {
					const turn = linking.then(() => (m.status === 'unlinked' ? m.link(linker) : undefined));
					linking = turn.catch(() => {});
					await turn;
				}
				await m.evaluate();
				return m;
			})();
			readied.set(m, r);
		}
		return r;
	};
	return {
		load: async (url, code) => ready(await load(url, code)),
		prime: (url, code) => void load(url, code)
	};
}

/** A module's V8 evaluation, by the exports object happy-dom handed it. */
const RUNNING = new WeakMap<object, Promise<void>>();
const INLINE = Symbol('ogygia.sim.inline');

/**
 * Replaces happy-dom's module compiler with V8's modules, in this process. Idempotent.
 *
 * happy-dom calls a compiled module's `execute` without awaiting it (its own compile is
 * synchronous), then hands the exports on: to a classic script's `import()`, or to the script
 * element that fires `load`. A V8 module loads and evaluates asynchronously, so `evaluate` is
 * wrapped to wait for it: an `import()` resolves to the full namespace, `load` fires after the module
 * ran, and a module that throws fails its importer instead of the host process.
 */
export function use_v8_modules(): void {
	const proto = (Compiler as unknown as { prototype: Record<string, unknown> }).prototype;
	if (proto.__v8) return;
	proto.__v8 = true;
	proto.compile = function (this: { window: Window }, url: string, code: string) {
		const window = this.window as Window & { [INLINE]?: number };
		// a module's source has arrived (happy-dom compiles at a `modulepreload` too): it is in the
		// document's module map from now, so an import of it later does not download it again
		if (url.split('#')[0] !== window.location.href.split('#')[0])
			loader_of(window).prime(url, code);
		return {
			imports: [],
			execute: (options: { exports: Record<string, unknown> }) => {
				const running = (async () => {
					// (an inline module has the document's URL: each gets its own identity; a module
					// already loaded as another's import is the same instance)
					const doc = window.location.href.split('#')[0];
					const id =
						url.split('#')[0] === doc
							? `${doc}#inline-${(window[INLINE] = (window[INLINE] ?? 0) + 1)}`
							: url;
					const m = await loader_of(window).load(id, code);
					const ns = m.namespace as Record<string, unknown>;
					for (const key of Object.keys(ns))
						Object.defineProperty(options.exports, key, { get: () => ns[key], enumerable: true });
				})();
				running.catch(() => {});
				RUNNING.set(options.exports, running);
			}
		};
	};
	const module = (Module as unknown as { prototype: Record<string, unknown> }).prototype;
	const evaluate = module.evaluate as (...a: unknown[]) => Promise<object>;
	module.evaluate = async function (this: unknown, ...a: unknown[]) {
		const exports = await evaluate.apply(this, a);
		await RUNNING.get(exports);
		return exports;
	};
}
