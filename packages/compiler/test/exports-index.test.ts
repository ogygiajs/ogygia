// The shared export index (src/compiler/exports/index.ts): one parse and one resolution per module
// for every caller of a resolver, and each policy's own answer over that one graph.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
