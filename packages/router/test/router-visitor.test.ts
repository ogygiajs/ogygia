import { describe, expect, it } from 'vitest';
import { anonymousVisitor } from '../src/visitor.ts';
import type { Ctx } from '../src/ctx.ts';

const as_ctx = (c: object) => c as unknown as Ctx;

describe('anonymousVisitor()', () => {
	it('mints an id into the cookie jar once, then hands the same id back', () => {
		const jar = new Map<string, string>();
		const sets: [string, string, object][] = [];
		const c = as_ctx({
			cookies: {
				get: (k: string) => jar.get(k),
				set: (k: string, v: string, o: object) => {
					jar.set(k, v);
					sets.push([k, v, o]);
				}
			}
		});
		const visitor = anonymousVisitor();
		const first = visitor(c)!;
		expect(first.anonymous).toBe(true);
		expect(sets).toEqual([
			['og-vid', first.sub, { path: '/', maxAge: 365 * 86_400, httpOnly: true, sameSite: 'lax' }]
		]);
		expect(visitor(c)!.sub).toBe(first.sub);
		expect(sets.length).toBe(1);
	});

	it('with no cookie jar to write, sets the cookie on the response headers', () => {
		const headers: Record<string, string>[] = [];
		const c = as_ctx({ setHeaders: (h: Record<string, string>) => headers.push(h) });
		const { sub } = anonymousVisitor({ cookie: 'vid', days: 2 })(c)!;
		expect(headers).toEqual([
			{ 'set-cookie': `vid=${sub}; Path=/; Max-Age=172800; HttpOnly; SameSite=Lax` }
		]);
	});

	it('mints a different random id for each new visitor', () => {
		const visitor = anonymousVisitor();
		const ids = new Set(Array.from({ length: 20 }, () => visitor(as_ctx({}))!.sub));
		expect(ids.size).toBe(20);
	});
});
