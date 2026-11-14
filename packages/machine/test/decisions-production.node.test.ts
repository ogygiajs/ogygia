import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decisions } from '../src/index.ts';

describe('decisions(): a production build', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('does not check fields (the check folds out), and still refuses', async () => {
		vi.stubEnv('DEV', false);
		vi.resetModules();
		const prod = await import('../src/decisions.ts');
		const d = prod.decisions({
			name: 'p',
			inputs: { a: ['x'] as string[] },
			refuse: (i) => (i.a === 'z' ? 'never z' : null),
			decide: (i) => i.a
		});
		const untyped = d as unknown as Decisions<{ a: string }, string>;
		expect(untyped.decide({ a: 'y' })).toBe('y');
		expect(() => untyped.decide({ a: 'z' })).toThrow('never z');
		expect(() => prod.decisions({ name: 'e', inputs: { a: [] }, decide: () => 0 })).not.toThrow();
	});

	it('a rules build (OGYGIA_RULES=1) keeps the field check', async () => {
		vi.stubEnv('DEV', false);
		vi.stubGlobal('__OGYGIA_RULES__', true);
		vi.resetModules();
		try {
			const rules = await import('../src/decisions.ts');
			const d = rules.decisions({
				name: 'r',
				inputs: { a: ['x'] as string[] },
				decide: (i) => i.a
			});
			expect(() => d.decide({ a: 'y' })).toThrow('`a` is "y"');
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
