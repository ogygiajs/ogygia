// DEV (#1376): a transform that moves the registry or the runtime marks reloads every virtual module
// whose last load read them. The runtime entry is chosen from the marks, so a page's first `idle`
// region needs the `interaction` feature: served from the entry loaded before the region existed,
// the region never woke until a restart. Found by the compiler DST harness (internal/compiler-dst,
// dev matches a cold start).
import { afterEach, expect, test } from 'vitest';
import { Compiler } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { CompileCtx } from '../src/ctx.ts';
import { normalize_import_keys } from '../src/region/transform.ts';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-reload-')));
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));
const PAGE = `${ROOT}/src/routes/+page.svelte`;
const write = (file: string, text: string) => {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
};
const RUNTIME_ENTRY = '\0ogygia:boot/runtime-entry';
const IDLE_PAGE = dedent`
	<script>
	import C0 from '$lib/C0.svelte' with { wake: 'idle' };
	</script>
	<C0 />
`;

function dev_compiler() {
	write(PAGE, `<h1>page</h1>\n`);
	write(`${ROOT}/src/routes/+layout.ts`, `export const csr = false;\n`);
	write(`${ROOT}/src/lib/C0.svelte`, `<p>C0</p>\n`);
	const program = new Program({ forms: true, router: true });
	const compiler = new Compiler(
		program,
		{
			prof: {
				transformMs: 0,
				transformN: 0,
				transformHit: 0,
				prescanMs: 0,
				macroMs: 0,
				macroN: 0,
				resolveMs: 0,
				loadMs: 0
			},
			P: false,
			outHash: new Map<string, number>()
		},
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
				app_shims: {}
			})
		)
	);
	compiler.prescan();
	return compiler;
}

/** The plugin's dev transform hook (vite/index.ts): the transform, then the ids it invalidates. */
async function dev_transform(compiler: Compiler, file: string, text: string): Promise<string[]> {
	await compiler.transform_module(text, file, {
		leg: compiler.leg({ name: 'ssr', server: true }),
		emitFile: () => ''
	});
	const out: string[] = [];
	out.push(...compiler.moved());
	out.push(...compiler.drain_closure_marks());
	return out;
}

const runtime_entry = (compiler: Compiler) =>
	compiler.emit(RUNTIME_ENTRY, { ssr: true, universalHooks: null }) as string;

test("a page's first idle region reloads the runtime entry, which then wakes it", async () => {
	const compiler = dev_compiler();
	expect(runtime_entry(compiler)).not.toContain('interaction');
	write(PAGE, IDLE_PAGE);
	expect(await dev_transform(compiler, PAGE, IDLE_PAGE)).toContain(RUNTIME_ENTRY);
	expect(runtime_entry(compiler)).toContain('interaction');
});

test('a transform that registers the same regions again reloads nothing', async () => {
	const compiler = dev_compiler();
	write(PAGE, IDLE_PAGE);
	await dev_transform(compiler, PAGE, IDLE_PAGE);
	runtime_entry(compiler);
	expect(await dev_transform(compiler, PAGE, IDLE_PAGE)).toEqual([]);
});
