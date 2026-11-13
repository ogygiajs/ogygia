import { describe, expect, it } from 'vitest';
import { createContext } from '../src/context-bridge.ts';

describe('createContext', () => {
	it("returns Svelte's [get, set, has] tuple and nothing of the old callable form", () => {
		const ctx = createContext<string>('theme');
		expect(Array.isArray(ctx)).toBe(true);
		expect(ctx).toHaveLength(3);
		expect(typeof ctx).toBe('object');
		expect('get' in ctx).toBe(false);
		expect('key' in ctx).toBe(false);
		const [get, set, has] = ctx;
		expect([typeof get, typeof set, typeof has]).toEqual(['function', 'function', 'function']);
	});

	it('takes no default value', () => {
		expect(createContext.length).toBe(1);
	});
});
