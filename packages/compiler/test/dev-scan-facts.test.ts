// DEV: a file's scan facts (a wire class, a `.remote.ts`, the import specs a router page walks) are
// read again when the dev server transforms it, not only by the start-up scan. A file added or edited
// while the server runs serves what a fresh start on the same files serves, and the modules that read
// those facts are reloaded. Each case compares a running dev compiler with a cold one.
import { afterEach, expect, test } from 'vitest';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-scan-facts-')));
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));
const write = (file: string, text: string) => {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
};
const PAGE_SPEC = '@ogygia/router';
const TRANSPORTABLES = '\0ogygia:region/transportables';
const KIT_TRANSPORT = '\0ogygia:region/kit-transport';

const WIRE_CLASS = dedent`
	export class Money {
		static wire = import.meta.og.wire({
			encode: (m) => m.cents,
			decode: (n) => new Money(n)
		});
		constructor(cents) {
			this.cents = cents;
		}
	}
`;

function start_files() {
	write(`${ROOT}/src/routes/+page.svelte`, `<h1>page</h1>\n`);
	write(`${ROOT}/src/routes/+layout.ts`, `export const csr = false;\n`);
	write(`${ROOT}/src/lib/C0.svelte`, `<p>C0</p>\n`);
}

/** A compiler on ROOT's files as they are now, started (the plugin's `buildStart` prescans). */
function compiler_on_disk() {
	const program = new Program({ forms: true, router: true });
	const compiler = new Compiler(program, {
		prof: {
			transformMs: 0,
			transformN: 0,
			transformHit: 0,
			prescanMs: 0,
			bakeMs: 0,
			bakeN: 0,
			resolveMs: 0,
			loadMs: 0
		},
		P: false,
		outHash: new Map<string, number>()
	});
	compiler.configure(
		new CompileCtx(
			partial_ctx_init({
				root: ROOT,
				base: '/',
				libDir: `${ROOT}/src/lib`,
				is_dev: true,
				is_build: false,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				runtime_dir: '/nowhere/ogygia/runtime',
				app_shims: {},
				page_importers: [PAGE_SPEC]
			})
		)
	);
	compiler.prescan();
	return compiler;
}

/** An editor saves `file`, then the plugin's dev transform hook runs on it (vite/index.ts): the
 *  transform, then the ids it invalidates. */
async function add(compiler: Compiler, file: string, text: string): Promise<string[]> {
	write(file, text);
	await compiler.transform_module(text, file, { ssr: true, emitFile: () => '' });
	return [...compiler.moved(), ...compiler.drain_closure_marks()];
}

const load = (compiler: Compiler, id: string, ssr: boolean): string => {
	const out = compiler.emit(id, { ssr, universalHooks: null }) as string | { code: string };
	return typeof out === 'string' ? out : out.code;
};

test("a wire class added while dev runs is in the browser's wire loaders, as after a restart", async () => {
	start_files();
	const dev = compiler_on_disk();
	load(dev, TRANSPORTABLES, false);
	const file = `${ROOT}/src/lib/money.ts`;
	const reloaded = await add(dev, file, WIRE_CLASS);
	expect(reloaded).toContain(TRANSPORTABLES);
	expect(load(dev, TRANSPORTABLES, false)).toContain('lib/money.ts');
	expect(load(dev, TRANSPORTABLES, false)).toBe(load(compiler_on_disk(), TRANSPORTABLES, false));
	expect(load(dev, TRANSPORTABLES, true)).toBe(load(compiler_on_disk(), TRANSPORTABLES, true));
});

test("an app's first remote file added while dev runs turns on Kit's codecs, as after a restart", async () => {
	start_files();
	const dev = compiler_on_disk();
	const before = load(dev, KIT_TRANSPORT, true);
	const reloaded = await add(
		dev,
		`${ROOT}/src/routes/data.remote.ts`,
		`export const answer = () => 42;\n`
	);
	expect(reloaded).toContain(KIT_TRANSPORT);
	expect(load(dev, KIT_TRANSPORT, true)).not.toBe(before);
	expect(load(dev, KIT_TRANSPORT, true)).toBe(load(compiler_on_disk(), KIT_TRANSPORT, true));
});

test('a router page module added while dev runs makes its components router CSS roots, as after a restart', async () => {
	start_files();
	write(
		`${ROOT}/src/lib/About.svelte`,
		dedent`
			<p>about</p>
			<style>p { color: red; }</style>
		`
	);
	const dev = compiler_on_disk();
	expect(dev.router_css_roots()).toEqual([]);
	await add(
		dev,
		`${ROOT}/src/lib/pages.ts`,
		dedent`
			import { page } from '${PAGE_SPEC}';
			import About from './About.svelte';
			export const pages = [page('/about', About)];
		`
	);
	expect(dev.router_css_roots()).toEqual([`${ROOT}/src/lib/About.svelte`]);
	expect(dev.router_css_roots()).toEqual(compiler_on_disk().router_css_roots());
});

test('an edit that removes the last wire class drops it from the wire loaders, as after a restart', async () => {
	start_files();
	const file = `${ROOT}/src/lib/money.ts`;
	write(file, WIRE_CLASS);
	const dev = compiler_on_disk();
	expect(load(dev, TRANSPORTABLES, false)).toContain('lib/money.ts');
	const reloaded = await add(dev, file, `export const cents = 1;\n`);
	expect(reloaded).toContain(TRANSPORTABLES);
	expect(load(dev, TRANSPORTABLES, false)).toBe(load(compiler_on_disk(), TRANSPORTABLES, false));
});
