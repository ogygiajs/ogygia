// The shared export index (src/compiler/exports/index.ts): one parse and one resolution per module
// for every caller of a resolver, and each policy's own answer over that one graph.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { EVERY_BARREL, ExportIndex, Shapes, type Policy } from '../src/compiler/exports/index.ts';
import {
	collectFoucCssReachable,
	through_caller,
	type WalkResolve
} from '../src/compiler/fouc-css.ts';

function graph(files: Record<string, string>) {
	const reads = new Map<string, number>();
	const resolves = new Map<string, number>();
	const read = (id: string): string | null => {
		reads.set(id, (reads.get(id) ?? 0) + 1);
		return files[id] ?? null;
	};
	const resolve = async (spec: string, importer: string): Promise<string | null> => {
		const key = `${importer} ${spec}`;
		resolves.set(key, (resolves.get(key) ?? 0) + 1);
		if (!spec.startsWith('.')) {
			const pkg = `/app/node_modules/${spec}/index.js`;
			return pkg in files ? pkg : null;
		}
		const base = path.posix.join(path.posix.dirname(importer), spec);
		for (const ext of ['', '.ts', '.js', '/index.ts']) if (base + ext in files) return base + ext;
		return null;
	};
	const shapes = new Shapes(read);
	const index = new ExportIndex<void>(resolve, shapes);
	return { index, shapes, reads, resolves, files };
}

const policy = (p: Partial<Policy>): Policy => ({ ...EVERY_BARREL, ...p });

describe('the CSS walk over an export index', () => {
	const files: Record<string, string> = {
		'/app/src/lib/A.svelte': `<script>import { Badge } from './bits';</script><Badge />`,
		'/app/src/lib/B.svelte': `<script>import { Badge } from './bits';</script><Badge />`,
		'/app/src/lib/bits/index.ts': `export { default as Badge } from './Badge.svelte';\nexport { default as Unused } from './Unused.svelte';`,
		'/app/src/lib/bits/Badge.svelte': `<b class="b"></b><style>.b { color: red }</style>`,
		'/app/src/lib/bits/Unused.svelte': `<b class="u"></b><style>.u { color: red }</style>`
	};

	it('walks every root through one parse of a shared barrel', async () => {
		const g = graph(files);
		const walk_index = new ExportIndex<WalkResolve>(through_caller, g.shapes);
		const opts = {
			root: '/app',
			libDir: '/app/src/lib',
			readFile: (p: string) => files[p] ?? null
		};
		const reached = [];
		for (const root of ['/app/src/lib/A.svelte', '/app/src/lib/B.svelte'])
			reached.push(
				(await collectFoucCssReachable(root, { ...opts, exports: walk_index })).map((e) => e.abs)
			);
		expect(reached).toEqual([
			['/app/src/lib/bits/Badge.svelte'],
			['/app/src/lib/bits/Badge.svelte']
		]);
		expect(g.reads.get('/app/src/lib/bits/index.ts'), 'the barrel parsed once').toBe(1);
		// without an index the walk makes its own, with the same answer
		expect(
			(await collectFoucCssReachable('/app/src/lib/A.svelte', opts)).map((e) => e.abs)
		).toEqual(['/app/src/lib/bits/Badge.svelte']);
	});
});

describe('the export index: one graph, a policy per caller', () => {
	it('parses each module and resolves each specifier once across policies', async () => {
		const g = graph({
			'/app/lib/index.ts': `export * from './mid';\nexport { c } from './c';`,
			'/app/lib/mid.ts': `export { a } from './a';\nexport { b } from './b';`,
			'/app/lib/a.ts': 'export const a = 1;',
			'/app/lib/b.ts': 'export const b = 1;',
			'/app/lib/c.ts': 'export const c = 1;'
		});
		const other = policy({ follow_packages: false });
		const one = await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL);
		const two = await g.index.map('/app/lib/index.ts', '$lib', other);
		expect([...one!.entries.keys()].sort()).toEqual(['a', 'b', 'c']);
		expect(two!.entries).toEqual(one!.entries);
		expect(two, 'each policy keeps its own map').not.toBe(one);
		expect(Math.max(...g.reads.values()), 'one parse per module').toBe(1);
		expect(Math.max(...g.resolves.values()), 'one resolution per specifier').toBe(1);
		expect(await g.index.map('/app/lib/index.ts', '$lib', other), 'memoized').toBe(two);
	});

	it('looks through a nested barrel unless the policy keeps it', async () => {
		const g = graph({
			'/app/lib/index.ts': `export { l } from './mid';`,
			'/app/lib/mid.ts': `export { l } from './leaf';`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		const keeps_mid = policy({ kept: (id) => id.endsWith('/mid.ts') });
		expect(
			(await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!.entries.get('l')
		).toEqual({ id: '/app/lib/leaf.ts', name: 'l' });
		expect((await g.index.map('/app/lib/index.ts', '$lib', keeps_mid))!.entries.get('l')).toEqual({
			id: '/app/lib/mid.ts',
			name: 'l'
		});
	});

	it('leaves a package star opaque unless the policy follows packages', async () => {
		const g = graph({
			'/app/lib/index.ts': `export * from 'pkg';`,
			'/app/node_modules/pkg/index.js': 'export const p = 1;'
		});
		const closed = (await g.index.map(
			'/app/lib/index.ts',
			'$lib',
			policy({ follow_packages: false })
		))!;
		expect(closed.opaque).toBe(true);
		expect(closed.entries.size).toBe(0);
		const open = (await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
		expect(open.opaque).toBe(false);
		expect(open.entries.get('p')).toEqual({ id: '/app/node_modules/pkg/index.js', name: 'p' });
	});

	it('maps an impure module only for a policy that forces it', async () => {
		const g = graph({
			'/app/lib/index.ts': `export { l } from './leaf';\nexport const store = make();`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		const left = await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL);
		expect(left).toMatchObject({ left: 'impure', pure: false });
		expect(left!.entries.size).toBe(0);
		const forced = await g.index.map('/app/lib/index.ts', '$lib', policy({ forced: () => true }));
		expect(forced!.pure).toBe(false);
		expect(forced!.left).toBeNull();
		expect(forced!.entries.get('l')).toEqual({ id: '/app/lib/leaf.ts', name: 'l' });
	});

	it('says why a barrel is left: kept by the policy, or not a candidate (outside the project)', async () => {
		const g = graph({
			'/app/lib/index.ts': `export { l } from './leaf';`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		const refuses = policy({ candidate: () => false });
		expect(await g.index.map('/app/lib/index.ts', '$lib', refuses)).toMatchObject({
			left: 'outside-project'
		});
		const keeps = policy({ kept: () => true });
		expect(await g.index.map('/app/lib/index.ts', '$lib', keeps)).toMatchObject({ left: 'kept' });
		expect((await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!.left).toBeNull();
	});

	it('a module that re-exports nothing is no barrel: null whatever the policy says of it', async () => {
		const g = graph({
			'/app/lib/util.ts': 'export function util() {}\nglobalThis.x = 1;',
			'/app/lib/plain.ts': 'export const p = 1;'
		});
		expect(await g.index.map('/app/lib/util.ts', './util', EVERY_BARREL)).toBeNull();
		const refuses = policy({ candidate: () => false });
		expect(await g.index.map('/app/lib/plain.ts', './plain', refuses)).toBeNull();
		const keeps = policy({ kept: () => true });
		expect(await g.index.map('/app/lib/plain.ts', './plain', keeps)).toBeNull();
	});

	it('re-parses only the edited file, and keeps its resolutions', async () => {
		const g = graph({
			'/app/lib/index.ts': `export { l } from './leaf';`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL);
		g.files['/app/lib/index.ts'] = `export { l as k } from './leaf';`;
		g.shapes.invalidate('/app/lib/index.ts', 'update');
		const after = (await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
		expect(after.entries.get('k')).toEqual({ id: '/app/lib/leaf.ts', name: 'l' });
		expect(g.reads.get('/app/lib/index.ts')).toBe(2);
		expect(g.reads.get('/app/lib/leaf.ts'), 'the untouched leaf is parsed once').toBe(1);
		expect(g.resolves.get('/app/lib/index.ts ./leaf'), 'an edit does not re-resolve').toBe(1);
	});

	it('a file added in dev reaches a barrel that re-exported it before it existed', async () => {
		const g = graph({
			'/app/lib/index.ts': `export { l } from './leaf';\nexport { m } from './more';`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		expect((await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!.opaque).toBe(true);
		g.files['/app/lib/more.ts'] = 'export const m = 1;';
		g.shapes.invalidate('/app/lib/more.ts', 'create');
		const after = (await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
		expect(after.opaque).toBe(false);
		expect(after.entries.get('m')).toEqual({ id: '/app/lib/more.ts', name: 'm' });
	});

	it('a ring of impure modules that star-export each other ends, with every name', async () => {
		const g = graph({
			'/app/lib/index.ts': `export * from './a';`,
			'/app/lib/a.ts': `console.log('a'); export const x = 1; export * from './b';`,
			'/app/lib/b.ts': `console.log('b'); export const y = 1; export * from './a';`
		});
		const map = (await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
		expect(map.entries.get('x')).toEqual({ id: '/app/lib/a.ts', name: 'x' });
		expect(map.entries.get('y')).toEqual({ id: '/app/lib/b.ts', name: 'y' });
	}, 2000);

	it('any graph of star exports ends, and every name a star reaches is found', async () => {
		const MODS = ['a', 'b', 'c', 'd'];
		const mod = fc.record({
			impure: fc.boolean(),
			stars: fc.subarray(MODS)
		});
		await fc.assert(
			fc.asyncProperty(fc.tuple(...MODS.map(() => mod)), async (mods) => {
				const files: Record<string, string> = {
					'/app/lib/index.ts': `export * from './a';`
				};
				mods.forEach((m, i) => {
					const name = MODS[i];
					files[`/app/lib/${name}.ts`] = [
						m.impure ? `console.log('${name}');` : '',
						`export const ${name}_own = 1;`,
						...m.stars.map((s) => `export * from './${s}';`)
					].join('\n');
				});
				// the spec's GetExportedNames: every module a star chain from `a` reaches
				const reached = new Set<string>();
				const visit = (name: string) => {
					if (reached.has(name)) return;
					reached.add(name);
					for (const s of mods[MODS.indexOf(name)].stars) visit(s);
				};
				visit('a');
				const map = (await graph(files).index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
				for (const name of reached)
					expect(map.entries.get(`${name}_own`), JSON.stringify(files)).toEqual({
						id: `/app/lib/${name}.ts`,
						name: `${name}_own`
					});
			}),
			{
				seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 5),
				numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 200)
			}
		);
	}, 10_000);

	it('a file deleted in dev leaves no barrel pointing at it', async () => {
		const g = graph({
			'/app/lib/index.ts': `export * from './mid';`,
			'/app/lib/mid.ts': `export { l } from './leaf';`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		expect(
			(await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!.entries.get('l')
		).toEqual({ id: '/app/lib/leaf.ts', name: 'l' });
		delete g.files['/app/lib/leaf.ts'];
		g.shapes.invalidate('/app/lib/leaf.ts', 'delete');
		const after = (await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
		expect(after.entries.has('l')).toBe(false);
		expect(after.opaque).toBe(true);
	});
});

describe('a barrel’s map, name by name', () => {
	const map_of = async (files: Record<string, string>, id = '/app/lib/index.ts') =>
		(await graph(files).index.map(id, '$lib', EVERY_BARREL))!;

	it('a star into a module that does not parse leaves the map opaque', async () => {
		const map = await map_of({
			'/app/lib/index.ts': `export * from './broken';\nexport { l } from './leaf';`,
			'/app/lib/broken.ts': 'export const = ;',
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		expect(map.opaque).toBe(true);
		expect(map.entries.get('l')).toEqual({ id: '/app/lib/leaf.ts', name: 'l' });
	});

	it('an id with a query is never a barrel', async () => {
		const g = graph({ '/app/lib/index.ts': `export { l } from './leaf';` });
		expect(await g.index.map('/app/lib/index.ts?raw', '$lib', EVERY_BARREL)).toBeNull();
	});

	it('an explicit export wins over a star, two stars with different leaves make a name ambiguous, and a star never brings default', async () => {
		const map = await map_of({
			'/app/lib/index.ts': `export { x } from './own'; export * from './a'; export * from './b';`,
			'/app/lib/own.ts': 'export const x = 0;',
			'/app/lib/a.ts': 'export const x = 1; export const y = 1; export default 1;',
			'/app/lib/b.ts': 'export const y = 2;'
		});
		expect(map.entries.get('x')).toEqual({ id: '/app/lib/own.ts', name: 'x' });
		expect(map.entries.get('y')).toBe('ambiguous');
		expect(map.entries.has('default')).toBe(false);
	});

	it('a re-export of a query import (?raw) stays on the barrel', async () => {
		const map = await map_of({
			'/app/lib/index.ts': `export { default as css } from './x.css?raw';`,
			'/app/lib/x.css?raw': '.a {}'
		});
		expect(map.entries.has('css')).toBe(false);
		expect(map.opaque).toBe(true);
	});

	it('a name ambiguous inside a nested barrel stays on the barrel', async () => {
		const map = await map_of({
			'/app/lib/index.ts': `export { y } from './mid';`,
			'/app/lib/mid.ts': `export * from './a';\nexport * from './b';`,
			'/app/lib/a.ts': 'export const y = 1;',
			'/app/lib/b.ts': 'export const y = 2;'
		});
		expect(map.entries.has('y')).toBe(false);
	});

	it('an impure nested module is a leaf in its own right (its code must run for the name)', async () => {
		const map = await map_of({
			'/app/lib/index.ts': `export { x } from './a';`,
			'/app/lib/a.ts': `console.log(1);\nexport { x } from './x';`,
			'/app/lib/x.ts': 'export const x = 1;'
		});
		expect(map.entries.get('x')).toEqual({ id: '/app/lib/a.ts', name: 'x' });
	});

	it('a ring of pure barrels is cached only once the walk that owns it closes it', async () => {
		const g = graph({
			'/app/lib/a.ts': `export * from './b';\nexport { x } from './x';`,
			'/app/lib/b.ts': `export * from './a';\nexport { y } from './y';`,
			'/app/lib/x.ts': 'export const x = 1;',
			'/app/lib/y.ts': 'export const y = 1;'
		});
		const a = (await g.index.map('/app/lib/a.ts', '$lib', EVERY_BARREL))!;
		expect([...a.entries.keys()].sort()).toEqual(['x', 'y']);
		const b = (await g.index.map('/app/lib/b.ts', '$lib', EVERY_BARREL))!;
		expect([...b.entries.keys()].sort()).toEqual(['x', 'y']);
	});

	it('a barrel built beside another build of its neighbour is served once, then rebuilt through the finished neighbour', async () => {
		const g = graph({
			'/app/lib/one.ts': `export { l } from './mid';`,
			'/app/lib/two.ts': `export { l } from './mid';`,
			'/app/lib/mid.ts': `export { l } from './leaf';`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		await Promise.all([
			g.index.map('/app/lib/one.ts', '$lib', EVERY_BARREL),
			g.index.map('/app/lib/two.ts', '$lib', EVERY_BARREL)
		]);
		for (const id of ['/app/lib/one.ts', '/app/lib/two.ts'])
			expect((await g.index.map(id, '$lib', EVERY_BARREL))!.entries.get('l'), id).toEqual({
				id: '/app/lib/leaf.ts',
				name: 'l'
			});
	});

	it('an edit during a build makes its caller build again from the file as it is now', async () => {
		const g = graph({
			'/app/lib/index.ts': `export { l } from './mid';`,
			'/app/lib/mid.ts': `export { l } from './leaf';`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		const pending = g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL);
		await Promise.resolve();
		g.files['/app/lib/index.ts'] = `export { l as k } from './mid';`;
		g.shapes.invalidate('/app/lib/index.ts', 'update');
		g.files['/app/lib/mid.ts'] = `export { l } from './leaf';\nexport { l as m } from './leaf';`;
		g.shapes.invalidate('/app/lib/mid.ts', 'update');
		const map = (await pending)!;
		expect(map.entries.has('k'), 'built from the edited barrel').toBe(true);
		expect(map.provisional, 'the nested build it lost is served once').toBe(true);
		await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL);
		const again = (await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
		const mid = (await g.index.map('/app/lib/mid.ts', '$lib', EVERY_BARREL))!;
		expect([again.provisional, [...mid.entries.keys()]]).toEqual([false, ['l', 'm']]);
		expect(again.entries.get('k')).toEqual({ id: '/app/lib/leaf.ts', name: 'l' });
	});

	it('an edit under a nested barrel during its build leaves the outer map served once, not kept', async () => {
		const files: Record<string, string> = {
			'/app/lib/index.ts': `export { l } from './mid';`,
			'/app/lib/mid.ts': `export { l } from './leaf'; export { k } from './k';`,
			'/app/lib/leaf.ts': 'export const l = 1;',
			'/app/lib/k.ts': 'export const k = 1;'
		};
		let reached!: () => void;
		const at_leaf = new Promise<void>((r) => (reached = r));
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const shapes = new Shapes((id) => files[id] ?? null);
		const index = new ExportIndex<void>(async (spec, importer) => {
			if (spec === './k') {
				reached();
				await gate;
			}
			return `${path.posix.join(path.posix.dirname(importer), spec)}.ts`;
		}, shapes);
		const pending = index.map('/app/lib/index.ts', '$lib', EVERY_BARREL);
		await at_leaf;
		shapes.invalidate('/app/lib/leaf.ts', 'update');
		release();
		expect((await pending)!.provisional).toBe(true);
		const again = (await index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
		expect(again.entries.get('l')).toEqual({ id: '/app/lib/leaf.ts', name: 'l' });
	});

	it('an edit to a module a star reached drops the barrel’s map', async () => {
		const g = graph({
			'/app/lib/index.ts': `export * from './a';`,
			'/app/lib/a.ts': 'export const x = 1;'
		});
		await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL);
		g.files['/app/lib/a.ts'] = 'export const z = 1;';
		g.shapes.invalidate('/app/lib/a.ts', 'update');
		const after = (await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL))!;
		expect([...after.entries.keys()]).toEqual(['z']);
	});

	it('an edit reported with forward slashes reaches ids a resolver spelled with backslashes', async () => {
		const files: Record<string, string> = {
			'C:\\app\\index.ts': `export * from './a';`,
			'C:\\app\\a.ts': 'export const x = 1;'
		};
		const shapes = new Shapes((id) => files[id] ?? null);
		const index = new ExportIndex<void>(async () => 'C:\\app\\a.ts', shapes);
		await index.map('C:\\app\\index.ts', '$lib', EVERY_BARREL);
		files['C:\\app\\a.ts'] = 'export const z = 1;';
		shapes.invalidate('C:/app/a.ts', 'update');
		const after = (await index.map('C:\\app\\index.ts', '$lib', EVERY_BARREL))!;
		expect([...after.entries.keys()]).toEqual(['z']);
	});
});
