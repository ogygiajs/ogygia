/**
 * The nested-island mark's context key is one key in every bundle that copies `nested.ts`: the
 * runtime (which hydrates an island with `nested_context`) and an island entry (which renders a
 * lake and reads `isNested`) are separate client graphs, each with its own copy. Two module copies
 * here stand in for the two graphs.
 */
import { expect, it } from 'vitest';
// (imported up front, so the copies below evaluate one module and compile nothing: no timeout on a
// loaded machine)
import * as nested from '../src/nested.ts';

type Nested = typeof nested;

it('two copies of nested.ts mark "inside an island" with the same context key', async () => {
	// (a query makes Vite load a second instance of the module; the cast is for the type only)
	const a = (await import('../src/nested.ts?copy=a' as string)) as Nested;
	const b = (await import('../src/nested.ts?copy=b' as string)) as Nested;
	expect(a).not.toBe(b);
	expect(a).not.toBe(nested);
	const [key_a] = a.nested_context().keys();
	const [key_b] = b.nested_context().keys();
	expect(key_a).toBe(key_b);
	expect(a.nested_context().get(key_a)).toBe(true);
});

it('the context an island is hydrated with keeps what a `<Provide>` above it gave', () => {
	const { nested_context } = nested;
	const base = new Map<unknown, unknown>([['theme', 'dark']]);
	const context = nested_context(base);
	expect(context.get('theme')).toBe('dark');
	expect(context).not.toBe(base);
	expect(base.size).toBe(1);
});
