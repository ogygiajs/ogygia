// The shared export index (src/compiler/exports/index.ts): one parse and one resolution per module
// for every caller of a resolver, and each policy's own answer over that one graph.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVERY_BARREL, ExportIndex, Shapes, type Policy } from '../src/compiler/exports/index.ts';

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
		expect(await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL)).toBeNull();
		const forced = await g.index.map('/app/lib/index.ts', '$lib', policy({ forced: () => true }));
		expect(forced!.pure).toBe(false);
		expect(forced!.entries.get('l')).toEqual({ id: '/app/lib/leaf.ts', name: 'l' });
	});

	it('answers null to a policy that does not take the module as a candidate', async () => {
		const g = graph({
			'/app/lib/index.ts': `export { l } from './leaf';`,
			'/app/lib/leaf.ts': 'export const l = 1;'
		});
		const refuses = policy({ candidate: () => false });
		expect(await g.index.map('/app/lib/index.ts', '$lib', refuses)).toBeNull();
		expect(await g.index.map('/app/lib/index.ts', '$lib', EVERY_BARREL)).not.toBeNull();
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
});
