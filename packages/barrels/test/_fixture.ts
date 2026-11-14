/**
 * Test harness: a throwaway project on disk (real files — the index reads the file system) and a
 * tiny resolver that mirrors what Vite gives the plugin: relative specifiers with extension /
 * index probing, a `$lib` alias, and bare specifiers through a fake `node_modules` with `exports`.
 */
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';
import { createServer, type InlineConfig, type Plugin } from 'vite';
import { ExportIndex, Shapes, type Change, type ExportMap, type Policy } from '@ogygia/compiler';
import { rewrite_imports, type Lookup, type RewritePolicy } from '../src/rewrite.ts';
import { rewrite_svelte } from '../src/svelte.ts';

/** A test's host: the reads, the resolver, and the barrel policy. */
export interface Host extends Policy {
	read: (id: string) => string | null;
	resolve(spec: string, importer: string): Promise<string | null>;
}

export type HostOverrides = Partial<Host> & { packages?: string[] };

/** One index over a host, its policy bound (as the plugin binds its own). */
export interface TestIndex {
	map(id: string, spec: string): Promise<ExportMap | null>;
	/** the file changed: what the dev server's watcher tells the shapes */
	invalidate(id: string, change?: Change): void;
	host: Host;
}

export interface Fixture {
	root: string;
	/** absolute id of a fixture file */
	id(rel: string): string;
	write(rel: string, content: string): string;
	read(rel: string): string;
	host(overrides?: HostOverrides): Host;
	index(overrides?: HostOverrides): TestIndex;
	/** rewrite a fixture file (JS/TS/Svelte) through a fresh index; returns the code or null */
	rewrite(rel: string, overrides?: HostOverrides, policy?: RewritePolicy): Promise<string | null>;
	lookup(index: TestIndex, importer: string): Lookup;
	/** what ogygia's `source` stage made of a fixture file in a dev server of `cfg` (whose first
	 *  plugin entry is `ogygia()`): the code the region transform is handed */
	source_stage(cfg: InlineConfig, rel: string): Promise<string>;
	dispose(): void;
}

const EXTS = [
	'',
	'.ts',
	'.js',
	'.mts',
	'.mjs',
	'.svelte',
	'.svelte.ts',
	'.svelte.js',
	'.json',
	'/index.ts',
	'/index.js'
];
const BACKSLASH_G = /\\/g;
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

export function fixture(files: Record<string, string>): Fixture {
	// realpath: macOS's tmpdir is a symlink (`/var` → `/private/var`) and the bundler reports real ids
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'barrels-'))).replace(BACKSLASH_G, '/');
	const id = (rel: string) => path.posix.join(root, rel);
	const write = (rel: string, content: string) => {
		const abs = id(rel);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, content);
		return abs;
	};
	for (const [rel, content] of Object.entries(files)) write(rel, content);
	// A real Vite build of the fixture compiles `.svelte` files, whose output imports `svelte/…`:
	// link the workspace's svelte into the fixture so bare imports resolve from the temp root.
	const svelte_dir = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
	mkdirSync(id('node_modules/@ogygia'), { recursive: true });
	symlinkSync(svelte_dir, id('node_modules/svelte'), 'dir');
	// ogygia() finds a listed plugin by its package, resolved from the app
	symlinkSync(PACKAGE_DIR, id('node_modules/@ogygia/barrels'), 'dir');

	const resolve_file = (base: string): string | null => {
		for (const ext of EXTS) {
			const p = base + ext;
			if (existsSync(p) && statSync(p).isFile()) return p;
		}
		return null;
	};
	const resolve_package = (spec: string): string | null => {
		const [scope_or_name, ...rest] = spec.split('/');
		const scoped = scope_or_name.startsWith('@');
		const name = scoped ? `${scope_or_name}/${rest.shift()}` : scope_or_name;
		const sub = rest.length ? `./${rest.join('/')}` : '.';
		const dir = path.posix.join(root, 'node_modules', name);
		const pkg_json = path.posix.join(dir, 'package.json');
		if (!existsSync(pkg_json)) return null;
		const pkg = JSON.parse(readFileSync(pkg_json, 'utf8')) as {
			exports?: unknown;
			main?: string;
			module?: string;
		};
		const pick = (v: unknown): string | null => {
			if (typeof v === 'string') return v;
			if (v && typeof v === 'object') {
				const o = v as Record<string, unknown>;
				return pick(o.import ?? o.default ?? o.svelte ?? null);
			}
			return null;
		};
		if (pkg.exports) {
			const ex = pkg.exports as Record<string, unknown> | string;
			const target = typeof ex === 'string' ? (sub === '.' ? ex : null) : pick(ex[sub]);
			return target ? path.posix.join(dir, target) : null;
		}
		if (sub !== '.') return resolve_file(path.posix.join(dir, sub));
		return resolve_file(path.posix.join(dir, pkg.module ?? pkg.main ?? 'index'));
	};

	const make_host = (overrides: HostOverrides = {}): Host => {
		const packages = overrides.packages ?? [];
		return {
			read: (p) => {
				try {
					return readFileSync(p, 'utf8');
				} catch {
					return null;
				}
			},
			resolve: async (spec, importer) => {
				if (spec.startsWith('$lib/'))
					return resolve_file(path.posix.join(root, 'lib', spec.slice(5)));
				if (spec === '$lib') return resolve_file(path.posix.join(root, 'lib'));
				if (spec.startsWith('.'))
					return resolve_file(path.posix.join(path.posix.dirname(importer), spec));
				if (spec.startsWith('/')) return resolve_file(spec);
				if (spec.startsWith('virtual:')) return spec;
				return resolve_package(spec);
			},
			candidate: (p, spec) => {
				if (packages.some((pk) => spec === pk || spec.startsWith(`${pk}/`))) return true;
				return !p.includes('/node_modules/') && p.startsWith(`${root}/`);
			},
			forced: () => false,
			kept: () => false,
			follow_packages: true,
			...overrides
		};
	};

	const make_index = (overrides?: HostOverrides): TestIndex => {
		const host = make_host(overrides);
		const shapes = new Shapes((p) => host.read(p));
		const index = new ExportIndex<void>((spec, importer) => host.resolve(spec, importer), shapes);
		return {
			map: (id, spec) => index.map(id, spec, host),
			invalidate: (id, change) => shapes.invalidate(id, change),
			host
		};
	};
	const lookup =
		(index: TestIndex, importer: string): Lookup =>
		async (spec) => {
			const resolved = await index.host.resolve(spec, importer);
			if (!resolved) return null;
			return index.map(resolved, spec);
		};

	return {
		root,
		id,
		write,
		read: (rel) => readFileSync(id(rel), 'utf8'),
		host: make_host,
		index: make_index,
		lookup,
		async rewrite(rel, overrides, policy) {
			const i = make_index(overrides);
			const importer = id(rel);
			const code = readFileSync(importer, 'utf8');
			const ms = new MagicString(code);
			const moves = importer.endsWith('.svelte')
				? await rewrite_svelte(code, importer, lookup(i, importer), ms, policy)
				: await rewrite_imports(code, importer, lookup(i, importer), ms, 0, policy);
			return moves.length ? ms.toString() : null;
		},
		async source_stage(cfg, rel) {
			let seen = '';
			const probe: Plugin = {
				name: 'probe',
				enforce: 'pre',
				transform(code, module_id) {
					if (module_id === id(rel)) seen = code;
				}
			};
			const [own, ...rest] = cfg.plugins ?? [];
			const plugins = [...(own as Plugin[])];
			plugins.splice(plugins.findIndex((p) => p.name === 'ogygia:source') + 1, 0, probe);
			const server = await createServer({
				...cfg,
				plugins: [plugins, ...rest],
				// (ogygia() lists its own `server.fs.allow`; Kit adds the app's, so a test does)
				server: { middlewareMode: true, hmr: false, fs: { allow: [root] } }
			});
			try {
				// ok: a later plugin may fail on the module; only the source stage's output is read
				await server.transformRequest(`/${rel}`).catch(() => null);
			} finally {
				await server.close();
			}
			return seen;
		},
		dispose: () => rmSync(root, { recursive: true, force: true })
	};
}
