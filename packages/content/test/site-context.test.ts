// A site's `context` that throws: the request reads the public projection, and the app is told why.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { content } from '../src/index.ts';
import type { Heading, Source, SourceEntry } from '../src/index.ts';
import { site } from '../src/site/site.ts';

type Meta = { headings: Heading[] };

function fromArray(entries: SourceEntry<Meta>[]): Source<Meta> {
	const map = new Map(entries.map((e) => [e.id, e]));
	return { get: async (id) => map.get(id) ?? null, refs: async () => entries.slice() };
}

const page = (id: string, n: number, data: Record<string, unknown>) =>
	({
		id,
		filePath: `content/docs/00-start/0${n}-${id}/+doc.svx`,
		order: [0, n],
		data,
		meta: { headings: [] }
	}) as unknown as SourceEntry<Meta>;

const docs = () =>
	content({
		loader: fromArray([
			page('install', 0, { title: 'Install' }),
			page('secret', 1, { title: 'Secret', draft: true })
		]),
		schema: v.object({ title: v.string(), draft: v.optional(v.boolean(), false) }),
		filter: (e, ctx) => !e.data.draft || ctx.preview === true
	});

const event = (path: string, slug: string) => ({
	params: { slug },
	url: new URL(`https://x.dev${path}`)
});
const status = (p: Promise<unknown>) =>
	p.then(
		() => 200,
		(e: { status?: number }) => e.status ?? 500
	);

afterEach(() => {
	vi.restoreAllMocks();
});

describe('a site context that throws', () => {
	it('serves the public projection and reports content_site_context_failed with the thrown error', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cause = new Error('no session');
		const s = site({
			outline: docs(),
			context: () => {
				throw cause;
			}
		});
		expect(await status(s.load(event('/install', 'install')))).toBe(200);
		expect(await status(s.load(event('/secret?preview', 'secret')))).toBe(404);
		expect(errors).toHaveBeenCalledTimes(2);
		const [reported, original] = errors.mock.calls[0]!;
		expect((reported as { code?: string }).code).toBe('content_site_context_failed');
		expect(String((reported as Error).message)).toContain(
			'https://ogygiajs.dev/e/content_site_context_failed'
		);
		expect(original).toBe(cause);
	});

	it('a context that answers reports nothing', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const s = site({ outline: docs(), context: () => ({ preview: true }) });
		expect(await status(s.load(event('/secret', 'secret')))).toBe(200);
		expect(errors).not.toHaveBeenCalled();
	});
});
