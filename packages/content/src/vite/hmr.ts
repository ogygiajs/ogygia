import fs from 'node:fs';
import path from 'node:path';
import MagicString from 'magic-string';
import type { ModuleNode, Plugin, ViteDevServer } from 'vite';
import { scope, type Scope } from '@ogygia/machine';
import { parse_module } from '@ogygia/core/internal/compiler';

const BACKSLASH = /\\/g;
const REMOTE_FILE = /\.remote\.(ts|js|mts|mjs)$/;

export type ContentHmrOptions = {
	/**
	 * Extra absolute dirs to watch in dev (in addition to `src/content`).
	 * Usually unnecessary — Vite already tracks `import.meta.glob` deps from `.remote.ts`.
	 */
	watchDirs?: string[];
	/**
	 * Dev: debounce filesystem events before full-reload (ms).
	 * Default `50`.
	 */
	hmrDebounceMs?: number;
};

/**
 * Invalidate a module and every importer.
 * Returns how many modules were touched.
 */
export function invalidateModuleTree(server: ViteDevServer, entry: ModuleNode | undefined): number {
	if (!entry) return 0;
	const seen = new Set<ModuleNode>();
	const stack: ModuleNode[] = [entry];
	while (stack.length) {
		const mod = stack.pop()!;
		if (seen.has(mod)) continue;
		seen.add(mod);
		server.moduleGraph.invalidateModule(mod);
		for (const importer of mod.importers) stack.push(importer);
	}
	return seen.size;
}

function is_remote_module(id: string) {
	const bare = id.split('?')[0].replace(BACKSLASH, '/');
	return REMOTE_FILE.test(bare);
}

/** The module that exports `content()`, as an app imports it. */
const CONTENT_MODULE = '@ogygia/content';
/** What a marked module calls its run's wrapper (see {@link mark_content_calls}). */
const RUN = '__og_content_run';

/** The ESTree nodes {@link mark_content_calls} reads (as Vite's parser gives them). */
type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Named = { name?: string; value?: string };

/** Each node under `node`, depth first. */
function* nodes(node: unknown): Generator<Node> {
	if (Array.isArray(node)) {
		for (const child of node) yield* nodes(child);
		return;
	}
	if (!node || typeof node !== 'object' || typeof (node as Node).type !== 'string') return;
	yield node as Node;
	for (const key in node) if (key !== 'type') yield* nodes((node as Node)[key]);
}

/**
 * Dev (#247): mark a server module's `content()` calls with the module and its run. A line at the
 * top asks the content graph for this run of the module (`module_run(id)`, once per run: each
 * evaluation of the module runs it again), and each call of the `content` it imports from
 * `@ogygia/content` (by name, or through a namespace) goes through what that returns, so the
 * collection knows which run of which module builds it. A collection a newer run builds replaces
 * the ones older runs built, so each edit leaves one, not one more. Null when the module calls no
 * `content()`.
 */
export function mark_content_calls(
	code: string,
	id: string
): { code: string; map: ReturnType<MagicString['generateMap']> } | null {
	// (core's one parser seam: the oxc parser, TypeScript and byte offsets as written; a module that
	// does not parse, mid-edit, is left alone)
	const { program, ok } = parse_module(code, id);
	if (!ok) return null;
	const named = new Set<string>();
	const namespaces = new Set<string>();
	for (const node of nodes(program)) {
		if (node.type !== 'ImportDeclaration') continue;
		if ((node.source as Named).value !== CONTENT_MODULE) continue;
		for (const s of node.specifiers as Node[]) {
			const local = (s.local as Named).name!;
			if (s.type === 'ImportNamespaceSpecifier') namespaces.add(local);
			else if (s.type === 'ImportSpecifier') {
				const imported = s.imported as Named;
				if ((imported.name ?? imported.value) === 'content') named.add(local);
			}
		}
	}
	if (!named.size && !namespaces.size) return null;
	const s = new MagicString(code);
	let marked = 0;
	for (const node of nodes(program)) {
		if (node.type !== 'CallExpression') continue;
		const callee = node.callee as Node;
		const calls =
			callee.type === 'Identifier'
				? named.has((callee as Named).name!)
				: callee.type === 'MemberExpression' &&
					!callee.computed &&
					(callee.object as Node).type === 'Identifier' &&
					namespaces.has((callee.object as Node as Named).name!) &&
					(callee.property as Node as Named).name === 'content';
		if (!calls) continue;
		s.appendLeft(callee.start, `${RUN}(`).prependRight(callee.end, ')');
		marked++;
	}
	if (!marked) return null;
	s.prepend(
		`const ${RUN} = globalThis[Symbol.for('ogygia.content.graph')]?.module_run?.(${JSON.stringify(id)}) ?? ((build) => build);\n`
	);
	return { code: s.toString(), map: s.generateMap({ hires: 'boundary', source: id }) };
}

/**
 * Content module runs (one of the `content()` plugin's Vite plugins), dev only: in each server
 * module, every `content()` call names the run of the module that makes it, so a newer run's
 * collection replaces an older run's (#247). A normal-order plugin: it sees plain JS (TypeScript
 * already stripped) with its imports still as written. Inert in a build.
 */
export function content_runs(): Plugin {
	return {
		name: 'ogygia:content-runs',
		apply: 'serve',
		transform(code, id, options) {
			if (!options?.ssr || !code.includes(CONTENT_MODULE)) return null;
			return mark_content_calls(code, id);
		}
	};
}

/**
 * Content dev HMR (one of the `content()` plugin's Vite plugins). Collections live in `.remote.ts` /
 * `.server.ts` modules; when a content file changes: invalidate the remotes → full-reload so SSR
 * catalogs refresh. Inert in a build.
 */
export function content_hmr(options: ContentHmrOptions = {}): Plugin {
	const debounceMs = Math.max(0, options.hmrDebounceMs ?? 50);
	let root = '';
	/**
	 * Each dev server's run of the plugin (its watcher listeners, its debounce), by the server's
	 * environments: closing an environment ends its server's run. By environment, not one run per
	 * plugin: a restart makes the new server (with this same plugin) before it closes the old one.
	 */
	const runs = new WeakMap<object, Scope>();

	return {
		name: 'ogygia:content-hmr',
		enforce: 'pre',

		configResolved(config) {
			root = config.root;
		},

		// the server closes (a restart, a quit): what its run still waits on goes with it
		closeBundle() {
			runs.get(this.environment)?.close();
		},

		configureServer(server) {
			const run = scope();
			for (const environment of Object.values(server.environments)) runs.set(environment, run);
			let cancel: (() => void) | null = null;
			let pending = new Set<string>();

			const watchRoots = new Set<string>();
			const contentDir = path.resolve(root, 'src/content');
			if (fs.existsSync(contentDir)) watchRoots.add(contentDir);
			for (const d of options.watchDirs ?? []) {
				watchRoots.add(path.resolve(d));
			}

			const under_watch = (abs: string) => {
				for (const base of watchRoots) {
					if (abs === base || abs.startsWith(base + path.sep)) return true;
				}
				return is_remote_module(abs);
			};

			const flush = () => {
				cancel = null;
				const files = [...pending];
				pending.clear();
				if (files.length === 0) return;

				let invalidated = 0;
				for (const file of files) {
					const mods = server.moduleGraph.getModulesByFile(file);
					if (mods) {
						for (const mod of mods) invalidated += invalidateModuleTree(server, mod);
					}
				}

				// Also poke every loaded .remote.ts so catalogs re-evaluate even if
				// the glob edge wasn't linked yet (e.g. new file matching a pattern).
				for (const mod of server.moduleGraph.idToModuleMap.values()) {
					const id = mod.id ?? mod.file ?? '';
					if (is_remote_module(id)) {
						invalidated += invalidateModuleTree(server, mod);
					}
				}

				server.config.logger.info(
					`[ogygia/content] sources changed (${files.length} file(s)) → invalidate ${invalidated} module(s), full-reload`
				);
				server.ws.send({ type: 'full-reload', path: '*' });
			};

			const schedule = (file: string) => {
				const abs = path.resolve(file);
				const base = path.basename(abs);
				if (base.endsWith('~') || base.startsWith('.#')) return;
				if (!under_watch(abs)) return;
				pending.add(abs);
				cancel?.();
				cancel = run.timeout(flush, debounceMs);
			};

			run.on(server.watcher, 'add', schedule);
			run.on(server.watcher, 'change', schedule);
			run.on(server.watcher, 'unlink', schedule);

			for (const dir of watchRoots) {
				if (fs.existsSync(dir)) server.watcher.add(dir);
			}
		}
	};
}
