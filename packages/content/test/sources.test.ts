// The source builders (folder, markdown, json, glob, blocks) and content(), read directly: what
// each one promises about ids, sidecars, faces and module shapes.
import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import type { Component } from 'svelte';
import { blocks, content, folder, glob, json, markdown } from '../src/index.ts';
import { withRemotes } from '../src/server.ts';

const svx = (metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	metadata,
	default: {},
	...extra
});

describe('folder()', () => {
	it('a file that is neither a page nor a sidecar fails at construction', () => {
		expect(() =>
			folder({ 'docs/00-a/+doc.svx': {}, 'docs/00-a/Widget.svelte': {} }, { format: json })
		).toThrow(/unexpected file 'docs\/00-a\/Widget.svelte'/);
	});

	it('bad numbering fails the first read, not construction', async () => {
		const src = folder(
			{ 'docs/01-a/+doc.svx': { title: 'a' }, 'docs/01-b/+doc.svx': { title: 'b' } },
			{ format: json }
		);
		await expect(src.init!()).rejects.toThrow(/duplicate prefix number 1/);
	});

	it('a lazy +meta.json is not loaded until the first read', async () => {
		let loads = 0;
		const src = folder(
			{
				'docs/00-a/+doc.svx': { title: 'a' },
				'docs/01-b/+doc.svx': { title: 'b' },
				'docs/00-a/+meta.json': async () => {
					loads++;
					return { label: 'Section A' };
				}
			},
			{ format: json }
		);
		expect(loads).toBe(0);
		expect((await src.groups!()).get('a')).toEqual({ label: 'Section A' });
		expect(loads).toBe(1);
	});

	it('a +meta.json wrapped in a default export is unwrapped', async () => {
		const src = folder(
			{
				'docs/00-a/+doc.svx': { title: 'a' },
				'docs/01-b/+doc.svx': { title: 'b' },
				'docs/00-a/+meta.json': { default: { label: 'Section A' } }
			},
			{ format: json }
		);
		expect((await src.groups!()).get('a')).toEqual({ label: 'Section A' });
	});

	it('an index.md sidecar wins over a page pattern that also matches it, and its title is the label', async () => {
		const src = folder(
			{
				'docs/01-a/index.md': { metadata: { title: 'Template syntax' } },
				'docs/01-a/01-b.md': { title: 'b' },
				'docs/02-c/01-d.md': { title: 'd' }
			},
			{ format: json, page: /\.md$/, meta: /\/index\.md$/ }
		);
		expect((await src.refs()).map((r) => r.id)).toEqual(['a/b', 'c/d']);
		expect((await src.groups!()).get('a')).toEqual({ label: 'Template syntax' });
	});
});

describe('markdown()', () => {
	it('a region-emitted module bakes its HTML into the body', async () => {
		const src = markdown({
			'./a.md': svx({ title: 'A' }, { __ogygia_region: { html: '<p>A</p>' } })
		});
		expect((await src.get('a'))!.body).toMatchObject({ kind: 'inline', html: '<p>A</p>' });
	});

	it('a module with its own styles threads its CSS key onto the body (baked or not)', async () => {
		const src = markdown({
			'./a.md': svx({ title: 'A' }, { __ogygia_css: 'k1' }),
			'./b.md': svx({ title: 'B' }, { __ogygia_css: 'k2', __ogygia_region: { html: '<p>B</p>' } }),
			'./c.md': svx({ title: 'C' })
		});
		expect((await src.get('a'))!.body).toMatchObject({ content_id: 'k1' });
		expect((await src.get('b'))!.body).toMatchObject({ content_id: 'k2' });
		expect('content_id' in ((await src.get('c'))!.body as object)).toBe(false);
	});
});

describe('glob()', () => {
	it('drops one extension only: a dotted name keeps its dots', async () => {
		const src = glob({ './docs/v1.2.svx': {}, './docs/a.b.json': {} });
		expect((await src.refs()).map((r) => r.id).sort()).toEqual(['a.b', 'v1.2']);
	});
});

describe('defineSource refs', () => {
	it('a ref carries neither body nor source, even when the format makes both', async () => {
		const src = markdown({
			'./a.md': svx({ title: 'A' }, { __ogygia_source: async () => 'raw' })
		});
		const [ref] = await src.refs();
		expect(Object.keys(ref).sort()).toEqual(['data', 'filePath', 'id', 'meta']);
	});
});

describe('content()', () => {
	it('the handle reaches its collection: withRemotes accepts it', () => {
		const c = content({ loader: json({ './a.json': { title: 'A' } }) });
		expect(() => withRemotes(c)).not.toThrow();
	});

	it('data is typed by the schema, and by every layer of a schema array', async () => {
		const one = content({
			schema: v.object({ title: v.string() }),
			loader: json({ './a.json': { title: 'A' } })
		});
		const title: string = (await one.get('a'))!.data.title;
		const layered = content({
			schema: [v.object({ title: v.string() }), v.object({ n: v.optional(v.number(), 1) })],
			loader: json({ './a.json': { title: 'A' } })
		});
		const e = (await layered.get('a'))!;
		const both: [string, number] = [e.data.title, e.data.n];
		expect([title, both]).toEqual(['A', ['A', 1]]);
	});

	it('a self relation resolves to the handle itself', async () => {
		const docs = content({
			schema: v.object({ title: v.string(), related: v.optional(v.string()) }),
			loader: json({ './a.json': { title: 'A', related: 'b' }, './b.json': { title: 'B' } }),
			relations: (self) => ({ related: self })
		});
		const a = (await docs.get('a'))! as unknown as { rel: { related: { id: string } | null } };
		expect(a.rel.related?.id).toBe('b');
	});
});

describe('blocks()', () => {
	const Hero = {
		__ogRegion: 'h1',
		__module: '/_app/immutable/og-region.h1.js',
		__component: (() => {}) as unknown as Component<Record<string, unknown>>,
		__sign: () => './__ogygia__?id=h1&sig=x',
		__renderHtml: () => '<div>x</div>'
	};
	const nodes_of = async (value: unknown) => {
		const src = blocks({ './p.json': value }, { Hero });
		await src.init?.();
		const e = (await src.get('p'))!;
		return {
			data: e.data,
			nodes: (e.body as unknown as { props: { nodes: unknown[] } }).props.nodes
		};
	};

	it('reads a bare array, a { blocks, meta } page, a { blocks, data } page and a single node', async () => {
		expect((await nodes_of([{ type: 'Hero' }])).nodes).toHaveLength(1);
		const meta = await nodes_of({ blocks: [{ type: 'Hero' }], meta: { title: 'M' } });
		expect(meta).toMatchObject({ data: { title: 'M' } });
		expect(meta.nodes).toHaveLength(1);
		expect((await nodes_of({ blocks: [], data: { title: 'D' } })).data).toEqual({ title: 'D' });
		expect((await nodes_of({ type: 'Hero' })).nodes).toHaveLength(1);
		expect(await nodes_of('nonsense')).toEqual({ data: {}, nodes: [] });
	});

	it('a JSON module wrapped in a default export is unwrapped', async () => {
		expect((await nodes_of({ default: [{ type: 'Hero' }] })).nodes).toHaveLength(1);
	});
});
