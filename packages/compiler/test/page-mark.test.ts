// THE PAGE MARK (link/runtime-entry.ts `page`): the page seed, the page store and the MPA navigation
// handle ship only when island code can reach Kit's page world. The prescan's island-closure walk
// decides, and it must fail OPEN: a miss would hand an island an empty `page.data` (the server still
// ships a seed for it), so anything the walk cannot follow counts as a reader.
import { describe, test, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../dist/compiler/index.js';
import {
	generateRuntimeFlagsSource,
	resolveFeatures
} from '../dist/compiler/link/runtime-entry.js';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const roots: string[] = [];
afterEach(() => {
	for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function marks_for(island: string, extra: Record<string, string> = {}, init: object = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-page-mark-'));
	roots.push(root);
	const files: Record<string, string> = {
		'src/routes/+layout.ts': 'export const csr = false;\n',
		'src/routes/+page.svelte': `${dedent`
			<script>
				import Island from '$lib/Island.svelte' with { wake: 'load' };
			</script>
			<Island />
		`}\n`,
		'src/lib/Island.svelte': island,
		...extra
	};
	for (const [rel, src] of Object.entries(files)) {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, src);
	}
	const program = new Program({ forms: false, router: false });
	const profiler = {
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
	};
	const compiler = new Compiler(program, profiler);
	compiler.configure(
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				libDir: path.join(root, 'src/lib'),
				is_dev: false,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				...init
			})
		)
	);
	compiler.prescan();
	return program.runtime_marks;
}

const script = (imports: string) =>
	`${dedent`
	<script>
	${imports}
	</script>
	<button>x</button>
`}\n`;

describe('page mark', () => {
	test('an island importing only Svelte, local helpers and assets reads no page', () => {
		const marks = marks_for(
			script(
				`	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { n } from './helper';
	import './island.css';
	import { dev } from '$app/environment';`
			),
			{ 'src/lib/helper.ts': `export const n = 1;\n`, 'src/lib/island.css': `p {}\n` }
		);
		expect(marks.page).toBe(false);
		const features = resolveFeatures(marks);
		expect(features).not.toContain('page');
		expect(features).not.toContain('mpa-nav');
	});

	test('`$app/state` anywhere in the closure is a reader', () => {
		const marks = marks_for(script(`\timport { read } from './helper';`), {
			'src/lib/helper.ts': `${dedent`
				import { page } from '$app/state';
				export const read = () => page.data;
			`}\n`
		});
		expect(marks.page).toBe(true);
		expect(resolveFeatures(marks)).toEqual(expect.arrayContaining(['page', 'mpa-nav']));
	});

	test('`$app/navigation` reaches the navigation handle', () => {
		expect(marks_for(script(`\timport { goto } from '$app/navigation';`)).page).toBe(true);
	});

	test('a package the walk cannot follow fails open', () => {
		expect(marks_for(script(`\timport { thing } from 'some-ui-kit';`)).page).toBe(true);
	});

	test('an import the walk cannot resolve fails open', () => {
		expect(marks_for(script(`\timport { thing } from './missing';`)).page).toBe(true);
	});

	test('a module the walk does not read (markdown) fails open', () => {
		const marks = marks_for(script(`\timport Doc from './doc.md';`), {
			'src/lib/doc.md': `# hi\n`
		});
		expect(marks.page).toBe(true);
	});

	test('a federated or plugin-woken island is a reader the walk never saw', () => {
		const island = script(`\timport { untrack } from 'svelte';`);
		expect(marks_for(island, {}, { foreign_hydrate: true }).page).toBe(true);
		expect(
			marks_for(
				island,
				{},
				{ client_plugins: [{ name: '@x/plugin', module: '/x/plugin/client.js' }] }
			).page
		).toBe(true);
	});
});

// A FEDERATED APP's page carries regions its own build never compiled: a peer's fragment brings its
// islands, its holes, its lakes. The features those need are in the build whatever the app's own
// regions are (#909: a peer's deferred widget, in a shell with no deferred region of its own, never
// loaded in production — the frame store and the element's fetch path were folded out).
describe('foreign regions', () => {
	const island = script(`\timport { untrack } from 'svelte';`);

	test('an app with no deferred region of its own does not ship the frame store', () => {
		const marks = marks_for(island);
		expect(resolveFeatures(marks)).not.toContain('frames');
		expect(generateRuntimeFlagsSource(marks)).toContain('FRAMES = false');
	});

	test("a federated app ships what a peer's regions need, with no region of its own needing it", () => {
		const marks = marks_for(island, {}, { foreign_hydrate: true });
		expect(resolveFeatures(marks)).toEqual(
			expect.arrayContaining(['frames', 'morph', 'lakes', 'interaction'])
		);
		expect(generateRuntimeFlagsSource(marks)).toContain('FRAMES = true');
	});
});
