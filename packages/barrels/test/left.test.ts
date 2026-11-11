/**
 * Why an import stayed on its barrel: the plugin tells ogygia through `t.emit` (one
 * `compile.barrel.left` event per import it leaves, with the reason), so the insight that finds a
 * barrel an island still imports whole can say why. One case per reason, through the plugin's own
 * source-stage transform over a real export index.
 */
import { afterEach, describe, expect, it } from 'vitest';
import MagicString from 'magic-string';
import { ExportIndex, Shapes } from '@ogygia/core/internal/compiler';
import type {
	BuildContext,
	PluginDefinition,
	StageTransform,
	TransformEvent
} from '@ogygia/core/vite';
import { fixture, type Fixture } from './_fixture.ts';
import { barrels, type BarrelsOptions } from '../src/index.ts';

let f: Fixture;
afterEach(() => f?.dispose());

/** What the plugin emitted while transforming `rel`. */
async function left_of(rel: string, options: BarrelsOptions = {}): Promise<TransformEvent[]> {
	const [definition, report] = barrels({ report: false, ...options });
	const host = f.host();
	const index = new ExportIndex<void>(
		(s, importer) => host.resolve(s, importer),
		new Shapes(host.read)
	);
	let stage: StageTransform | null = null;
	const b = {
		root: f.root,
		dev: false,
		transform: (s: StageTransform) => void (stage = s),
		exports: { map: (file, spec, policy) => index.map(file, spec, policy) },
		pinnedImports: () => (decl) => decl.attribute_keys.includes('wake')
	} as Partial<BuildContext> as BuildContext;
	(definition as unknown as Record<symbol, PluginDefinition>)[Symbol.for('ogygia.plugin')].build!(
		b
	);
	(report.configResolved as (c: unknown) => void)({
		root: f.root,
		command: 'build',
		logger: { info: () => {} }
	});
	const events: TransformEvent[] = [];
	const id = f.id(rel);
	const code = f.read(rel);
	const quiet = console.warn;
	console.warn = () => {};
	try {
		await stage!.transform({
			id,
			code,
			edit: new MagicString(code),
			environment: 'client',
			resolve: (s, importer) => host.resolve(s, importer),
			watch: () => {},
			emit: (e) => void events.push(e)
		});
	} finally {
		console.warn = quiet;
	}
	return events;
}

const left = (barrel: string | null, names: string[], reason: string) => ({
	domain: 'compile',
	name: 'compile.barrel.left',
	barrel,
	names,
	reason
});

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
		expect(await left_of('src/x.ts')).toEqual([left(f.id('lib/index.ts'), ['a'], 'impure')]);
	});

	it('kept: barrels({ keep }) lists it', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';`,
			'src/x.ts': `import { a } from '$lib';\nconsole.log(a);`
		});
		expect(await left_of('src/x.ts', { keep: [/lib\/index/] })).toEqual([
			left(f.id('lib/index.ts'), ['a'], 'kept')
		]);
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
		expect(await left_of('src/x.ts')).toEqual([
			left(f.id('node_modules/ui/index.js'), ['u'], 'outside-project')
		]);
	});

	it('opaque: a star into a module the index cannot read hides where a name lives', async () => {
		f = fixture({
			...base,
			'lib/data.json': '{}',
			'lib/index.ts': `export { a } from './a';\nexport * from './data.json';`,
			'src/x.ts': `import { a, hidden } from '$lib';\nconsole.log(a, hidden);`
		});
		expect(await left_of('src/x.ts')).toEqual([left(f.id('lib/index.ts'), ['hidden'], 'opaque')]);
	});

	it('own: the name is defined in the barrel itself (a forced impure barrel)', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';\nexport const store = make();`,
			'src/x.ts': `import { a, store } from '$lib';\nconsole.log(a, store);`
		});
		expect(await left_of('src/x.ts', { force: [/lib\/index/] })).toEqual([
			left(f.id('lib/index.ts'), ['store'], 'own')
		]);
	});

	it('ambiguous: two stars give the same name', async () => {
		f = fixture({
			...base,
			'lib/x1.ts': 'export const dup = 1;',
			'lib/x2.ts': 'export const dup = 2;',
			'lib/index.ts': `export { a } from './a';\nexport * from './x1';\nexport * from './x2';`,
			'src/x.ts': `import { a, dup } from '$lib';\nconsole.log(a, dup);`
		});
		expect(await left_of('src/x.ts')).toEqual([left(f.id('lib/index.ts'), ['dup'], 'ambiguous')]);
	});

	it('pinned: the import carries a region mark, so it stays as written', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';`,
			'src/x.ts': `import { a } from '$lib' with { wake: 'load' };\nconsole.log(a);`
		});
		expect(await left_of('src/x.ts')).toEqual([left(f.id('lib/index.ts'), ['a'], 'pinned')]);
	});

	it('namespace: the barrel is imported whole', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';`,
			'src/x.ts': `import * as lib from '$lib';\nconsole.log(lib);`
		});
		expect(await left_of('src/x.ts')).toEqual([left(f.id('lib/index.ts'), ['*'], 'namespace')]);
	});

	it('unparsable: a component the parser cannot read keeps every barrel it imports', async () => {
		f = fixture({
			...base,
			'lib/index.ts': `export { a } from './a';`,
			'src/Broken.svelte': `<script>import { a } from '$lib';\n<div>`
		});
		expect(await left_of('src/Broken.svelte')).toEqual([left(null, [], 'unparsable')]);
	});
});

describe('what is not a barrel left behind says nothing', () => {
	it('an import that moved, a plain module, a type-only or side-effect import, a name the barrel lacks', async () => {
		f = fixture({
			...base,
			'lib/util.ts': 'export function util() {}\nglobalThis.x = 1;',
			'lib/index.ts': `export { a } from './a';\nexport { b } from './b';\nexport type T = number;`,
			'src/x.ts': `import { a, nope } from '$lib';\nimport { util } from '$lib/util';\nimport type { T } from '$lib';\nimport '$lib';\nconsole.log(a, nope, util);`
		});
		expect(await left_of('src/x.ts')).toEqual([]);
	});
});
