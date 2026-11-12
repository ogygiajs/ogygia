// withRemotes(): which Kit remote each read mints, with which options, and what it answers by default.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { content, json, type Source } from '../src/index.ts';
import { withRemotes } from '../src/server.ts';

const calls = vi.hoisted(() => ({ prerender: [] as unknown[][] }));
vi.mock('$app/server', async (importOriginal) => {
	const real = await importOriginal<typeof import('$app/server')>();
	return {
		...real,
		prerender: (...args: unknown[]) => {
			calls.prerender.push(args);
			return (real.prerender as (...a: unknown[]) => unknown)(...args);
		}
	};
});

afterEach(() => {
	calls.prerender.length = 0;
});

const schema = v.object({ title: v.string() });
const type_of = (remote: unknown) => (remote as { __: { type: string } }).__.type;
const rows = [{ id: 'a', data: { title: 'A' } }];
const plain: Source = {
	refs: async () => rows,
	get: async (id) => rows.find((r) => r.id === id) ?? null
};

describe('withRemotes()', () => {
	it('list prerenders a static source, with dynamic on by default', () => {
		const r = withRemotes(content({ schema, loader: json({ './a.json': { title: 'A' } }) }));
		expect(type_of(r.list())).toBe('prerender');
		expect(calls.prerender.at(-1)?.[1]).toEqual({ dynamic: true });
		r.list({ dynamic: false });
		expect(calls.prerender.at(-1)?.[1]).toEqual({ dynamic: false });
	});

	it('list is a query by default for a source that reads at request time', () => {
		const dynamic = withRemotes(content({ schema, loader: { ...plain, dynamic: true } as Source }));
		expect(type_of(dynamic.list())).toBe('query');
		const live = withRemotes(
			content({
				schema,
				loader: {
					...plain,
					live: () => ({
						[Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) })
					})
				}
			})
		);
		expect(type_of(live.list())).toBe('query');
	});

	it('live.get answers null for a missing id unless notFound says otherwise', async () => {
		const r = withRemotes(content({ schema, loader: plain }));
		const missing = (await r.live.get()('nope')) as unknown as AsyncGenerator<unknown>;
		expect((await missing.next()).value).toBeNull();
		await missing.return?.(undefined);
		const custom = (await r.live.get({ notFound: 'none' })(
			'nope'
		)) as unknown as AsyncGenerator<unknown>;
		expect((await custom.next()).value).toBe('none');
		await custom.return?.(undefined);
	});

	it('a value that is not a content() handle is refused with its code', () => {
		expect(() => withRemotes({ refs: () => [] })).toThrow(/content_with_remotes_not_collection/);
	});
});
