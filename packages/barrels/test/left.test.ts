/**
 * Why an import stayed on its barrel: the plugin records each import it leaves, with the reason,
 * and answers ogygia's `b.stayed` ask, so the insight that finds a barrel an island still imports
 * whole can say why. One case per reason, through the plugin's own source-stage transform over a
 * real export index.
 */
import { afterEach, describe, expect, it } from 'vitest';
import MagicString from 'magic-string';
import { ExportIndex, Shapes } from '@ogygia/compiler';
import type {
	BuildContext,
	PluginDefinition,
	StageTransform,
	StayedAnswer
} from '@ogygia/compiler/vite';
import { fixture, type Fixture } from './_fixture.ts';
import { barrels, type BarrelsOptions } from '../src/index.ts';
import { dedent } from '@ogygia/core/plugin/utils';

let f: Fixture;
afterEach(() => f?.dispose());

/** The plugin over a real export index: transform a module, ask why a barrel stayed, begin a leg. */
function plugin_of(options: BarrelsOptions = {}, command: 'build' | 'serve' = 'build') {
	const [definition, report] = barrels({ report: false, ...options });
	const host = f.host();
	const index = new ExportIndex<void>(
		(s, importer) => host.resolve(s, importer),
		new Shapes(host.read)
	);
	let stage: StageTransform | null = null;
	let stayed: StayedAnswer | null = null;
	const b = {
		root: f.root,
		dev: command === 'serve',
		transform: (s: StageTransform) => void (stage = s),
		stayed: (answer: StayedAnswer) => void (stayed = answer),
		exports: { map: (file, spec, policy) => index.map(file, spec, policy) },
		pinnedImports: () => (decl) => decl.attribute_keys.includes('wake')
	} as Partial<BuildContext> as BuildContext;
	(definition as unknown as Record<symbol, PluginDefinition>)[Symbol.for('ogygia.plugin')].build!(
		b
	);
	(report.configResolved as (c: unknown) => void)({
		root: f.root,
		command,
		logger: { info: () => {} }
	});
	return {
		async transform(rel: string, code = f.read(rel), environment = 'client') {
			const quiet = console.warn;
			console.warn = () => {};
			try {
				await stage!.transform({
					id: f.id(rel),
					code,
					edit: new MagicString(code),
					environment,
					resolve: (s, importer) => host.resolve(s, importer),
					watch: () => {}
				});
			} finally {
				console.warn = quiet;
			}
		},
		why: (barrel: string, importers: string[], environment = 'client') =>
			stayed!(barrel, importers, environment),
		begin: (environment: string) =>
			(report.buildStart as (this: unknown) => void).call({ environment: { name: environment } })
	};
}

/** Why each barrel stayed after the plugin transformed `rel` alone. */
async function left_of(rel: string, options: BarrelsOptions = {}) {
	const p = plugin_of(options);
	await p.transform(rel);
	return (barrel: string) => p.why(f.id(barrel), [f.id(rel)]);
}

const base = {
	'package.json': JSON.stringify({ name: 'app', type: 'module' }),
	'lib/a.ts': 'export const a = 1;',
	'lib/b.ts': 'export const b = 2;'
};

describe('each import the plugin leaves on its barrel is told, with the reason', () => {
	it('impure: the barrel runs code of its own', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';\nexport const store = make();`,
			'src/x.ts': `import { a } from '$lib';\nconsole.log(a);`
		});
		expect((await left_of('src/x.ts'))('lib/index.ts')).toEqual(['impure']);
	});

	it('kept: barrels({ keep }) lists it', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';`,
			'src/x.ts': `import { a } from '$lib';\nconsole.log(a);`
		});
		expect((await left_of('src/x.ts', { keep: [/lib\/index/] }))('lib/index.ts')).toEqual(['kept']);
	});

	it('outside-project: a package that barrels({ packages }) does not list', async () => {
		f = fixture({
			...base,
			'node_modules/ui/package.json': JSON.stringify({
				name: 'ui',
				exports: { '.': './index.js' }
			}),
			'node_modules/ui/leaf.js': 'export const u = 1;',
			'node_modules/ui/index.js': `export { u } from './leaf.js';`,
			'src/x.ts': `import { u } from 'ui';\nconsole.log(u);`
		});
		expect((await left_of('src/x.ts'))('node_modules/ui/index.js')).toEqual(['outside-project']);
	});

	it('opaque: a star into a module the index cannot read hides where a name lives', async () => {
		f = fixture({
			...base,
			'lib/data.json': '{}',
			'lib/index.ts': `export { a } from './a';\nexport * from './data.json';`,
			'src/x.ts': `import { a, hidden } from '$lib';\nconsole.log(a, hidden);`
		});
		expect((await left_of('src/x.ts'))('lib/index.ts')).toEqual(['opaque']);
	});

	it('own: the name is defined in the barrel itself (a forced impure barrel)', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';\nexport const store = make();`,
			'src/x.ts': `import { a, store } from '$lib';\nconsole.log(a, store);`
		});
		expect((await left_of('src/x.ts', { force: [/lib\/index/] }))('lib/index.ts')).toEqual(['own']);
	});

	it('ambiguous: two stars give the same name', async () => {
		f = fixture({
			...base,
			'lib/x1.ts': 'export const dup = 1;',
			'lib/x2.ts': 'export const dup = 2;',
			'lib/index.ts': dedent`
				export { a } from './a';
				export * from './x1';
				export * from './x2';
			`,
			'src/x.ts': `import { a, dup } from '$lib';\nconsole.log(a, dup);`
		});
		expect((await left_of('src/x.ts'))('lib/index.ts')).toEqual(['ambiguous']);
	});

	it('pinned: the import carries a region mark, so it stays as written', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';`,
			'src/x.ts': `import { a } from '$lib' with { wake: 'load' };\nconsole.log(a);`
		});
		expect((await left_of('src/x.ts'))('lib/index.ts')).toEqual(['pinned']);
	});

	it('namespace: the barrel is imported whole', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';`,
			'src/x.ts': `import * as lib from '$lib';\nconsole.log(lib);`
		});
		expect((await left_of('src/x.ts'))('lib/index.ts')).toEqual(['namespace']);
	});

	it('unparsable: a component the parser cannot read keeps every barrel it imports', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';`,
			'src/Broken.svelte': `<script>import { a } from '$lib';\n<div>`
		});
		expect((await left_of('src/Broken.svelte'))('lib/index.ts')).toEqual(['unparsable']);
	});
});

describe('what is not a barrel left behind says nothing', () => {
	it('an import that moved, a plain module, a type-only or side-effect import, a name the barrel lacks', async () => {
		f = fixture({
			...base,
			'lib/util.ts': 'export function util() {}\nglobalThis.x = 1;',
			'lib/index.ts': dedent`
				export { a } from './a';
				export { b } from './b';
				export type T = number;
			`,
			'src/x.ts': dedent`
				import { a, nope } from '$lib';
				import { util } from '$lib/util';
				import type { T } from '$lib';
				import '$lib';
				console.log(a, nope, util);
			`
		});
		const why = await left_of('src/x.ts');
		for (const barrel of ['lib/index.ts', 'lib/util.ts', 'lib/a.ts'])
			expect(why(barrel)).toEqual([]);
	});
});

describe('what the plugin said holds for its leg until the module or the leg begins again', () => {
	const pinned = `import { a } from '$lib' with { wake: 'load' };\nconsole.log(a);`;
	const moved = `import { a } from '$lib';\nconsole.log(a);`;
	const files = { ...base, 'lib/index.ts': `export { a } from './a';`, 'src/x.ts': pinned };

	it('a module transformed again forgets what it said before', async () => {
		f = fixture(files);
		const p = plugin_of();
		await p.transform('src/x.ts');
		expect(p.why(f.id('lib/index.ts'), [])).toEqual(['pinned']);
		await p.transform('src/x.ts', moved);
		expect(p.why(f.id('lib/index.ts'), [])).toEqual([]);
	});

	it("each leg answers for itself; a build leg that begins again drops its last build's word", async () => {
		f = fixture(files);
		const p = plugin_of();
		await p.transform('src/x.ts', pinned, 'client');
		await p.transform('src/x.ts', pinned, 'ssr');
		p.begin('client');
		expect(p.why(f.id('lib/index.ts'), [], 'client')).toEqual([]);
		expect(p.why(f.id('lib/index.ts'), [], 'ssr')).toEqual(['pinned']);
	});

	it('the dev server is one build: nothing is dropped when it starts', async () => {
		f = fixture(files);
		const p = plugin_of({}, 'serve');
		await p.transform('src/x.ts');
		p.begin('client');
		expect(p.why(f.id('lib/index.ts'), [])).toEqual(['pinned']);
	});
});
