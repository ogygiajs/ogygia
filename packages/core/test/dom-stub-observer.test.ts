/**
 * The DOM stub's MutationObserver (test/_stubs/dom.ts), which the bench files run the runtime's
 * observer paths on: records as the browser makes them for child lists and text, with and without
 * `subtree`, taken synchronously or delivered in a microtask, and nothing after `disconnect`.
 */
import { describe, expect, it } from 'vitest';
import { document, el } from './_stubs/dom.ts';

type Rec = { type: string; target: unknown; addedNodes: unknown[]; removedNodes: unknown[] };
const MO = (
	globalThis as unknown as {
		MutationObserver: new (cb: (r: Rec[]) => void) => {
			observe(t: unknown, o: Record<string, boolean>): void;
			takeRecords(): Rec[];
			disconnect(): void;
		};
	}
).MutationObserver;

describe('dom stub MutationObserver', () => {
	it('child list of the target only, unless subtree', () => {
		const root = el('<div><p><b></b></p></div>');
		const p = root.firstChild!;
		const direct = new MO(() => {});
		const deep = new MO(() => {});
		direct.observe(root, { childList: true });
		deep.observe(root, { childList: true, subtree: true });
		const span = document.createElement('span');
		root.appendChild(span);
		p.appendChild(document.createElement('i'));
		const d = direct.takeRecords();
		expect(d.map((r) => [r.type, r.target, r.addedNodes.length])).toEqual([['childList', root, 1]]);
		expect(deep.takeRecords().map((r) => r.target)).toEqual([root, p]);
		span.remove();
		expect(direct.takeRecords()[0].removedNodes).toEqual([span]);
		direct.disconnect();
		deep.disconnect();
	});

	it('a move is a removal, then an addition', () => {
		const root = el('<ul><li>a</li><li>b</li></ul>');
		const mo = new MO(() => {});
		mo.observe(root, { childList: true });
		const [a, b] = root.childNodes;
		root.insertBefore(b, a);
		const recs = mo.takeRecords();
		expect(recs.map((r) => [r.removedNodes[0] ?? null, r.addedNodes[0] ?? null])).toEqual([
			[b, null],
			[null, b]
		]);
		mo.disconnect();
	});

	it('text through `data`, delivered in a microtask; nothing after disconnect', async () => {
		const root = el('<p>x</p>');
		const seen: Rec[] = [];
		const mo = new MO((r) => seen.push(...r));
		mo.observe(root, { characterData: true, subtree: true });
		(root.firstChild as unknown as { data: string }).data = 'y';
		expect(seen).toEqual([]);
		await Promise.resolve();
		expect(seen.map((r) => r.type)).toEqual(['characterData']);
		mo.disconnect();
		(root.firstChild as unknown as { data: string }).data = 'z';
		await Promise.resolve();
		expect(seen).toHaveLength(1);
	});

	it('attributes are refused, not silently missed', () => {
		const mo = new MO(() => {});
		expect(() => mo.observe(el('<p></p>'), { attributes: true })).toThrow(/not supported/);
	});
});
