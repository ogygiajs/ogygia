import { expect, it } from 'vitest';
import { render_made } from '../src/runtime/ownership.ts';

it('a node the inlined restorer placed counts as render output: one set per document, across bundles', () => {
	const node = { nodeType: 3 } as Node;
	const w = globalThis as { __og_rendered?: WeakSet<Node> };
	const kept = w.__og_rendered;
	w.__og_rendered = new WeakSet([node]);
	try {
		expect(render_made(node, new Set())).toBe(true);
	} finally {
		w.__og_rendered = kept;
	}
});
