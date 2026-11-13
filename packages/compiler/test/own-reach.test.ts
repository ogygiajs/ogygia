// WHAT AN APP REACHES OF OGYGIA: the prescan decides from the app's own files whether it provides
// cross-island context (the `context` mark ships the bridge) and whether it puts a region or a
// content value on Kit's wire (`crosses_wire` ships the codec cluster). A miss is silent: islands
// lose their context, or Kit cannot decode a region. Every form that can reach a provider or a
// region is counted; a form that reaches neither is not.
import { describe, test, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../dist/compiler/index.js';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const roots: string[] = [];
afterEach(() => {
	for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function prescan(files: Record<string, string>) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-own-reach-'));
	roots.push(root);
	const all: Record<string, string> = {
		'src/routes/+layout.ts': 'export const csr = false;\n',
		...files
	};
	for (const [rel, src] of Object.entries(all)) {
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
			bakeMs: 0,
			bakeN: 0,
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
				pkg_root: '/nowhere/ogygia'
			})
		)
	);
	compiler.prescan();
	return { context: program.runtime_marks.context === true, crosses_wire: program.crosses_wire };
}

const page = (script: string, markup = '<p>x</p>') =>
	`${dedent`
	<script>
	${script}
	</script>
	${markup}
`}\n`;

describe('a context provider is found in every form that reaches it', () => {
	test.each([
		[
			'a local barrel re-exports setContext',
			{
				'src/lib/og.ts': `export { setContext } from 'ogygia';\n`,
				'src/routes/+layout.svelte': page(
					`\timport { setContext } from '$lib/og';\n\tsetContext('theme', 'dark');`,
					'<slot />'
				)
			}
		],
		[
			'a local barrel re-exports Provide under another name',
			{
				'src/lib/og.ts': `export { Provide as Give } from 'ogygia';\n`,
				'src/routes/+layout.svelte': page(
					`\timport { Give } from '$lib/og';`,
					'<Give values={{ a: 1 }}><slot /></Give>'
				)
			}
		],
		[
			'a local barrel star-exports ogygia',
			{
				'src/lib/og.ts': `export * from 'ogygia';\n`,
				'src/routes/+layout.svelte': page(
					`\timport { setContext } from '$lib/og';\n\tsetContext('theme', 'dark');`,
					'<slot />'
				)
			}
		],
		[
			'a local barrel star-exports ogygia as a namespace',
			{
				'src/lib/og.ts': `export * as og from 'ogygia';\n`,
				'src/routes/+layout.svelte': page(
					`\timport { og } from '$lib/og';\n\tog.setContext('theme', 'dark');`,
					'<slot />'
				)
			}
		],
		[
			'a namespace import is handed on',
			{
				'src/lib/og.ts': dedent`
					import * as og from 'ogygia';
					export { og };
				`,
				'src/routes/+layout.svelte': page(
					`\timport { og } from '$lib/og';\n\tog.setContext('theme', 'dark');`,
					'<slot />'
				)
			}
		],
		[
			'a dynamic import destructures setContext',
			{
				'src/lib/theme.ts': dedent`
					export async function provide_theme() {
						const { setContext } = await import('ogygia');
						setContext('theme', 'dark');
					}
				`
			}
		],
		[
			'a dynamic import reads createContext off the module',
			{
				'src/lib/theme.ts': `export const make = async () => (await import('ogygia')).createContext('theme');\n`
			}
		],
		[
			'a dynamic import is kept whole',
			{
				'src/lib/theme.ts': `export const lib = () => import('ogygia');\n`
			}
		],
		[
			'a namespace names Provide in markup',
			{
				'src/routes/+layout.svelte': page(
					`\timport * as og from 'ogygia';`,
					'<og.Provide values={{ a: 1 }}><slot /></og.Provide>'
				)
			}
		],
		[
			'a dynamic import in a component',
			{
				'src/routes/+layout.svelte': page(
					`\timport('ogygia').then((m) => m.setContext('theme', 'dark'));`,
					'<slot />'
				)
			}
		]
	])('%s', (_name, files) => {
		expect(prescan(files).context).toBe(true);
	});
});

describe('a form that reaches no provider ships no bridge', () => {
	test.each([
		[
			'a barrel re-exports only getContext',
			{ 'src/lib/og.ts': `export { getContext } from 'ogygia';\n` }
		],
		[
			'a dynamic import destructures only getContext',
			{
				'src/lib/theme.ts': `export const read = async () => (await import('ogygia')).getContext('theme');\n`
			}
		],
		[
			'a namespace import reads only getContext',
			{
				'src/lib/theme.ts': dedent`
					import * as og from 'ogygia';
					export const read = () => og.getContext('theme');
				`
			}
		],
		['the word alone', { 'src/lib/theme.ts': `export const setContext = 1; // ogygia\n` }]
	])('%s', (_name, files) => {
		expect(prescan(files).context).toBe(false);
	});
});

describe("a region or content value on Kit's wire is found in every form", () => {
	test.each([
		[
			'a local barrel re-exports region',
			{
				'src/lib/og.ts': `export { region } from 'ogygia';\n`,
				'src/routes/+page.server.ts': dedent`
					import { region } from '$lib/og';
					export const load = () => ({ r: region });
				`
			}
		],
		['a local barrel star-exports ogygia', { 'src/lib/og.ts': `export * from 'ogygia';\n` }],
		[
			'a namespace import is handed on',
			{
				'src/lib/og.ts': dedent`
					import * as og from 'ogygia';
					export default og;
				`
			}
		],
		[
			'a dynamic import reads site',
			{
				'src/routes/+page.server.ts': `export const load = async () => ({ s: (await import('ogygia')).site });\n`
			}
		],
		[
			'a dynamic import of the content package',
			{
				'src/routes/+page.server.ts': `export const load = async () => ({ c: await import('@ogygia/content') });\n`
			}
		],
		[
			'a barrel re-exports the content package',
			{ 'src/lib/content.ts': `export * from '@ogygia/content';\n` }
		]
	])('%s', (_name, files) => {
		expect(prescan(files).crosses_wire).toBe(true);
	});

	test('a barrel of non-wire ogygia names does not cross', () => {
		expect(prescan({ 'src/lib/og.ts': `export { preload } from 'ogygia';\n` }).crosses_wire).toBe(
			false
		);
	});
});
