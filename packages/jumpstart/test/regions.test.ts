import { describe, expect, it } from 'vitest';
import { RegionGroups, clean_id } from '../src/regions.ts';

const seam = (hosts: Record<string, string[]>) => ({
	hosts: () => new Map(Object.entries(hosts).map(([h, ids]) => [h, new Set(ids)]))
});

describe('region groups', () => {
	it('cleans a module id: no NUL prefix, no query, forward slashes', () => {
		expect(clean_id('\0ogygia:region/entry/abc.js')).toBe('ogygia:region/entry/abc.js');
		expect(clean_id('/app/src/B.svelte?svelte&type=style&lang.css')).toBe('/app/src/B.svelte');
		expect(clean_id('C:\\app\\src\\B.svelte')).toBe('C:/app/src/B.svelte');
	});

	it('a script registry gets one group: itself, its components and the modules minted for them', () => {
		const groups = new RegionGroups(
			seam({
				'/app/src/lib/registry.ts': [
					'ogygia:region/wrapper/a.svelte',
					'/app/src/lib/A.svelte',
					'/app/src/lib/B.svelte'
				]
			})
		);
		expect(Object.fromEntries(groups.groups())).toEqual({
			'regions-registry': [
				'/app/src/lib/registry.ts',
				'ogygia:region/wrapper/a.svelte',
				'/app/src/lib/A.svelte',
				'/app/src/lib/B.svelte'
			]
		});
		expect(groups.group('\0ogygia:region/wrapper/a.svelte'.slice(1))).toBe('regions-registry');
	});

	it('a Svelte module that marks regions gets no group, and a component it marks stays out of every group', () => {
		const groups = new RegionGroups(
			seam({
				'/app/src/routes/+page.svelte': [
					'/app/src/lib/Shared.svelte',
					'/app/src/lib/Inline.svelte'
				],
				'/app/src/lib/registry.ts': ['/app/src/lib/Shared.svelte', '/app/src/lib/Block.svelte']
			})
		);
		expect(groups.group('/app/src/lib/Block.svelte')).toBe('regions-registry');
		expect(groups.group('/app/src/lib/Shared.svelte')).toBeNull();
		expect(groups.group('/app/src/lib/Inline.svelte')).toBeNull();
		expect(groups.group('/app/src/routes/+page.svelte')).toBeNull();
		expect(groups.member('/app/src/lib/Inline.svelte')).toBe(true);
		expect(groups.member('/app/src/routes/+page.svelte')).toBe(true);
		expect(groups.member('/app/src/lib/util.ts')).toBe(false);
	});

	it('two registries get a group each, a shared component goes with the first by path, and names never collide', () => {
		const groups = new RegionGroups(
			seam({
				'/app/src/b/blocks.ts': ['/app/src/Shared.svelte', '/app/src/B.svelte'],
				'/app/src/a/blocks.ts': ['/app/src/Shared.svelte', '/app/src/A.svelte'],
				'/app/src/c/my blocks.js': ['/app/src/C.svelte']
			})
		);
		expect(groups.group('/app/src/Shared.svelte')).toBe('regions-blocks');
		expect(groups.group('/app/src/A.svelte')).toBe('regions-blocks');
		expect(groups.group('/app/src/B.svelte')).toBe('regions-blocks-2');
		expect(groups.group('/app/src/C.svelte')).toBe('regions-my-blocks');
	});

	it('reads the live table again after reset (a second build sees regions found later)', () => {
		const table: Record<string, string[]> = { '/app/src/registry.ts': ['/app/src/A.svelte'] };
		const groups = new RegionGroups(seam(table));
		expect(groups.group('/app/src/B.svelte')).toBeNull();
		table['/app/src/registry.ts'] = ['/app/src/A.svelte', '/app/src/B.svelte'];
		expect(groups.group('/app/src/B.svelte')).toBeNull();
		groups.reset();
		expect(groups.group('/app/src/B.svelte')).toBe('regions-registry');
	});
});

describe('the shared chunk', () => {
	const graph = (edges: Record<string, string[]>, entries: string[]) =>
		new Map(
			Object.entries(edges).map(([id, imports]) => [id, { entry: entries.includes(id), imports }])
		);
	const dependency = (id: string) => id.includes('/node_modules/');

	it('app code a registry and a page outside it both import is shared; what only the registry reaches is not', () => {
		const groups = new RegionGroups(
			seam({
				'/app/src/registry.ts': ['/app/src/A.svelte'],
				'/app/src/routes/inline/+page.svelte': ['/app/src/Inline.svelte']
			})
		);
		groups.shape(
			graph(
				{
					'/app/src/routes/p/+page.svelte': ['/app/src/registry.ts'],
					'/app/src/registry.ts': ['/app/src/A.svelte'],
					'/app/src/A.svelte': [
						'/app/src/util.js',
						'/app/src/only-a.js',
						'/x/node_modules/dep/i.js'
					],
					'/app/src/routes/inline/+page.svelte': ['/app/src/Inline.svelte'],
					'/app/src/Inline.svelte': ['/app/src/util.js'],
					'/app/src/util.js': ['/x/node_modules/dep/i.js'],
					'/app/src/only-a.js': [],
					'/x/node_modules/dep/i.js': []
				},
				['/app/src/routes/p/+page.svelte', '/app/src/routes/inline/+page.svelte']
			),
			dependency
		);
		expect(groups.shared('/app/src/util.js')).toBe(true);
		expect(groups.shared('/app/src/only-a.js')).toBe(false);
		expect(groups.shared('/app/src/A.svelte')).toBe(false);
		expect(groups.shared('/x/node_modules/dep/i.js')).toBe(false);
		expect(groups.shared('/app/src/Inline.svelte')).toBe(false);
	});

	it('an entry that imports a block only through the registry shares nothing with it', () => {
		const groups = new RegionGroups(seam({ '/app/src/registry.ts': ['/app/src/A.svelte'] }));
		groups.shape(
			graph(
				{
					'/app/src/routes/p/+page.svelte': ['/app/src/registry.ts'],
					'\0ogygia:region/entry/a.js': ['/app/src/A.svelte'],
					'/app/src/registry.ts': ['/app/src/A.svelte'],
					'/app/src/A.svelte': ['/app/src/only-a.js'],
					'/app/src/only-a.js': []
				},
				['/app/src/routes/p/+page.svelte', '\0ogygia:region/entry/a.js']
			),
			dependency
		);
		expect(groups.shared('/app/src/only-a.js')).toBe(false);
		groups.reset();
		expect(groups.shared('/app/src/only-a.js')).toBe(false);
	});
});
