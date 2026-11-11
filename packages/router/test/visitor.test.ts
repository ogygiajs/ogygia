// `anonymousVisitor()`: a logged-out visitor's id lives in `vid`, never in `sub` (the field a
// session's user id sits in, which mount() signs onward to peers as who is browsing).
import { describe, expect, it } from 'vitest';
import { anonymousVisitor } from '../src/visitor.ts';
import type { Ctx } from '../src/ctx.ts';

const ctx = (cookie?: string) => {
	const set: string[] = [];
	const c = {
		cookies: {
			get: (n: string) => (n === 'og-vid' ? cookie : undefined),
			set: (n: string, v: string) => void set.push(`${n}=${v}`)
		}
	} as unknown as Ctx;
	return { c, set };
};

describe('anonymousVisitor', () => {
	it('a returning visitor is `{ vid, anonymous }`, with no `sub`', () => {
		const v = anonymousVisitor()(ctx('v-42').c);
		expect(v).toEqual({ vid: 'v-42', anonymous: true });
		expect(v).not.toHaveProperty('sub');
	});

	it('a first visit mints the id into the cookie and returns it as `vid`', () => {
		const { c, set } = ctx();
		const v = anonymousVisitor()(c);
		expect(v).not.toHaveProperty('sub');
		expect(typeof v?.vid).toBe('string');
		expect(set).toEqual([`og-vid=${v?.vid}`]);
	});
});
