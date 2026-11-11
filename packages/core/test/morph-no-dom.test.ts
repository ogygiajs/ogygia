import { expect, test } from 'vitest';

test('the morph loads under plain node with no DOM (ogygia/internal/reconcile imports it there)', async () => {
	expect((globalThis as { Node?: unknown }).Node).toBeUndefined();
	expect((globalThis as { document?: unknown }).document).toBeUndefined();
	const morph = await import('../src/runtime/morph.ts');
	expect(typeof morph.morph_children).toBe('function');
});
