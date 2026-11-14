// A watch rebuild starts a fresh program (#1389): the island-closure walk must mark every file an
// island reaches in the NEW island graph, not skip the ones the first build walked. A file left out
// resolves `$app/*` to Kit's real store, empty under `csr = false` (#1448).
import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../src/index.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

let root = '';
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-watch-closure-'));
	const files: Record<string, string> = {
		'src/routes/+layout.ts': 'export const csr = false;\n',
		'src/routes/+page.svelte': `${dedent`
			<script>
				import W from '$lib/W.svelte' with { wake: 'visible' };
			</script>
			<W />
		`}\n`,
		'src/lib/W.svelte': `${dedent`
			<script>
				import { who } from './who.ts';
			</script>
			<p>{who()}</p>
		`}\n`,
		'src/lib/who.ts': `${dedent`
			import { page } from '$app/state';
			export const who = () => page.url.pathname;
		`}\n`
	};
	for (const [rel, src] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), src);
	}
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

it('a watch rebuild marks the island’s whole closure again (#1448)', () => {
	const compiler = new Compiler(
		new Program({ forms: true, router: true }),
		{
			prof: {
				transformMs: 0,
				transformN: 0,
				transformHit: 0,
				prescanMs: 0,
				resolveMs: 0,
				loadMs: 0
			} as Compiler['profiler']['prof'],
			P: false,
			outHash: new Map()
		},
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				app_dir: '_app',
				runtime_hash: '0123456789ab',
				libDir: path.join(root, 'src/lib'),
				is_dev: false,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				is_build: true,
				pkg_root: '/nowhere/ogygia',
				app_shims: {}
			})
		)
	);
	const who = path.join(root, 'src/lib/who.ts');
	compiler.start_leg('client', false);
	compiler.prescan();
	expect(compiler.program.island_graph.has(who)).toBe(true);
	// the rebuild: the same leg starts again
	compiler.start_leg('client', false);
	compiler.prescan();
	expect(compiler.program.island_graph.has(who)).toBe(true);
});
