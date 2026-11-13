// A third party edits an island NESTED in another island while both sleep, and the element around
// the nested island also holds an `{@html}` (the compiler stamps it `data-og-html`). The outer
// island's wake must put the nested island's server markup back before Svelte's walk, as it does
// for a drift anywhere else in the island: Svelte's walk binds inside the nested island, so it is
// not `{@html}` content to leave alone. Before, the drift was never seen there, and the outer
// island threw its hydration away (#1425).
import { beforeEach, expect, inject, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { bootDev } from '../../src/runtime/full.ts';

const decode = (key: 'nest_page_ssr_b64') => decodeURIComponent(escape(atob(inject(key))));

beforeEach(() => {
	document.body.innerHTML = '';
});

test('a third party edits an island nested beside an {@html}: the outer island wakes from its server markup', async () => {
	document.body.innerHTML = decode('nest_page_ssr_b64');
	const outer = document.querySelector('ogygia-region')!;
	// (a nested island renders inline, in its host's markup: here the Counter's paragraph)
	const inner = outer.querySelector('[data-host] > p')!;
	expect(inner, 'the fixture nests an island').not.toBeNull();
	expect(inner.querySelector('[data-testid="count"]')).not.toBeNull();
	const warns: string[] = [];
	const real_warn = console.warn;
	console.warn = (...a: unknown[]) => warns.push(a.map(String).join(' '));
	try {
		bootDev(); // the outer island connects: keeps its server markup, arms the interaction
		// the third party: a node of its own first in the nested island's paragraph
		const b = document.createElement('b');
		b.textContent = 'third party';
		inner.prepend(b);

		await userEvent.click(outer.querySelector('span')!);
		await expect.poll(() => outer.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
		expect(outer.hasAttribute('data-og-healed'), 'hydrated from the server markup').toBe(true);
		expect(outer.hasAttribute('data-og-recovered'), 'NOT Svelte’s client re-render').toBe(false);
		expect(
			warns.filter((w) => /hydration_(mismatch|discarded)|discarded its ENTIRE/.test(w))
		).toEqual([]);
		// the nested island is live: its button counts
		const count = () => outer.querySelector('[data-testid="count"]')!.textContent;
		expect(count()).toBe('1');
		await userEvent.click(outer.querySelector('button')!);
		await expect.poll(count).toBe('2');
	} finally {
		console.warn = real_warn;
	}
});
