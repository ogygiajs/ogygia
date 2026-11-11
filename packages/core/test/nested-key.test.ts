/**
 * The nested-island mark's context key is one key in every bundle that copies `nested.ts`: the
 * runtime (which hydrates an island with `nested_context`) and an island entry (which renders a
 * lake and reads `isNested`) are separate client graphs, each with its own copy. Two module copies
 * here stand in for the two graphs.
 */
import { expect, it } from 'vitest';

it('two copies of nested.ts mark "inside an island" with the same context key', async () => {
	const a = await import('../src/nested.ts?copy=a');
	const b = await import('../src/nested.ts?copy=b');
	expect(a).not.toBe(b);
	const [key_a] = a.nested_context().keys();
	const [key_b] = b.nested_context().keys();
	expect(key_a).toBe(key_b);
	expect(a.nested_context().get(key_a)).toBe(true);
});

it('the context an island is hydrated with keeps what a `<Provide>` above it gave', async () => {
	const { nested_context } = await import('../src/nested.ts');
	const base = new Map<unknown, unknown>([['theme', 'dark']]);
	const context = nested_context(base);
	expect(context.get('theme')).toBe('dark');
	expect(context).not.toBe(base);
	expect(base.size).toBe(1);
});
