// The links() check: what it judges, and a corpus that collects no link data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { content } from '../src/index.ts';
import type { Source, SourceEntry } from '../src/index.ts';
import { site } from '../src/site/site.ts';
import { links } from '../src/site/checks.ts';

type Meta = Record<string, unknown>;

function corpus(meta_by_id: Record<string, Meta>) {
	const entries: SourceEntry<Meta>[] = Object.entries(meta_by_id).map(([id, meta], i) => ({
		id,
		filePath: `content/docs/0${i}-${id}/+doc.svx`,
		order: [i],
		data: { title: id },
		meta
	}));
	const map = new Map(entries.map((e) => [e.id, e]));
	const source: Source<Meta> = {
		get: async (id) => map.get(id) ?? null,
		refs: async () => entries.slice()
	};
	return content({ loader: source, schema: v.object({ title: v.string() }) });
}

afterEach(() => vi.restoreAllMocks());

describe('links() check', () => {
	it('a relative link (a colocated asset) is not judged', async () => {
		const s = site({
			outline: corpus({
				guide: { headings: [], links: [{ href: 'diagram.png', text: 'asset' }] }
			}),
			checks: [links()]
		});
		expect(await s.check({ base: '/docs' })).toEqual([]);
	});

	it('a page with no links property is warned about once and passes; links: [] is link data', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const none = site({
			outline: corpus({ a: { headings: [] }, b: { headings: [] } }),
			checks: [links()]
		});
		expect(await none.check({ base: '/docs' })).toEqual([]);
		expect(
			warn.mock.calls.filter((c) => String(c[0]).includes('content_links_no_data'))
		).toHaveLength(1);
		warn.mockClear();
		const empty = site({
			outline: corpus({ a: { headings: [], links: [] } }),
			checks: [links()]
		});
		expect(await empty.check({ base: '/docs' })).toEqual([]);
		expect(warn).not.toHaveBeenCalled();
	});
});
