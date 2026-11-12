// THE FRONT DOOR STAYS SMALL: `ogygia` depends only on @ogygia/core and @ogygia/compiler, and neither
// core nor the compiler reaches a plugin package. Every other package (devtools, insights, content,
// flags, …) is installed by the app that wants it and imported from its own name; no `ogygia/*` path
// forwards to it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

/** What `ogygia` may depend on. */
const FRONT_DOOR = new Set(['@ogygia/core', '@ogygia/compiler']);
/** Shared building blocks and build tooling: not plugins. */
const FOUNDATION = new Set([
	'ogygia',
	'@ogygia/core',
	'@ogygia/compiler',
	'@ogygia/machine',
	'@ogygia/config',
	'@ogygia/tooling',
	'@ogygia/tsdown-plugin-svelte'
]);

type Manifest = {
	name?: string;
	private?: boolean;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

function manifest(dir: string): Manifest | null {
	try {
		return JSON.parse(
			fs.readFileSync(path.join(PACKAGES, dir, 'package.json'), 'utf8')
		) as Manifest;
	} catch {
		return null;
	}
}

const packages = fs
	.readdirSync(PACKAGES, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => ({ dir: d.name, json: manifest(d.name) }))
	.filter((p): p is { dir: string; json: Manifest } => !!p.json?.name);

/** Every published package that is not foundation: a plugin, installed on its own. */
const PLUGINS = packages
	.map((p) => p.json.name!)
	.filter((name) => name.startsWith('@ogygia/') && !FOUNDATION.has(name));

const deps_of = (json: Manifest): string[] => [
	...Object.keys(json.dependencies ?? {}),
	...Object.keys(json.devDependencies ?? {}),
	...Object.keys(json.peerDependencies ?? {}),
	...Object.keys(json.optionalDependencies ?? {})
];

// (a static import or re-export starts its line, so an import written inside a message's text is not one)
const IMPORT_RE =
	/^\s*(?:(?:import|export)\b[^;'"]*?from\s+|import\s+)['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/gm;

function* source_files(dir: string): Generator<string> {
	if (!fs.existsSync(dir)) return;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* source_files(p);
		else if (/\.(ts|js|svelte)$/.test(e.name) && !e.name.endsWith('.d.ts')) yield p;
	}
}

/** The plugin packages a package's source imports: `file: specifier`. */
function plugin_imports(dir: string): string[] {
	const out: string[] = [];
	for (const file of source_files(path.join(PACKAGES, dir, 'src'))) {
		const text = fs.readFileSync(file, 'utf8');
		for (const m of text.matchAll(IMPORT_RE)) {
			const spec = m[1] ?? m[2]!;
			if (PLUGINS.some((name) => spec === name || spec.startsWith(`${name}/`)))
				out.push(`${path.relative(PACKAGES, file)}: ${spec}`);
		}
	}
	return out;
}

describe('package boundaries', () => {
	it('finds the plugin packages it guards against', () => {
		expect(PLUGINS).toContain('@ogygia/devtools');
		expect(PLUGINS).toContain('@ogygia/insights');
	});

	it('ogygia depends on @ogygia/core and @ogygia/compiler only', () => {
		const ogygia = packages.find((p) => p.json.name === 'ogygia')!;
		const ours = Object.keys(ogygia.json.dependencies ?? {}).filter((d) =>
			d.startsWith('@ogygia/')
		);
		expect(ours.filter((d) => !FRONT_DOOR.has(d))).toEqual([]);
	});

	it('neither ogygia, core nor the compiler lists a plugin package', () => {
		for (const name of ['ogygia', '@ogygia/core', '@ogygia/compiler']) {
			const p = packages.find((q) => q.json.name === name);
			if (!p) continue;
			expect(
				deps_of(p.json).filter((d) => PLUGINS.includes(d)),
				name
			).toEqual([]);
		}
	});

	it('neither ogygia, core nor the compiler imports a plugin package', () => {
		for (const name of ['ogygia', '@ogygia/core', '@ogygia/compiler']) {
			const p = packages.find((q) => q.json.name === name);
			if (!p) continue;
			expect(plugin_imports(p.dir), name).toEqual([]);
		}
	});
});
