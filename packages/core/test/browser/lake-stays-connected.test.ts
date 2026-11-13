// An island's hydrate adopts each lake in it as it stands: Svelte's walk never enters a lake. The
// lake's nodes stay in the document the whole time, so a custom element in it never sees a
// disconnect it did not cause, and what its own runtime did to its light DOM is left alone (#1675).
import { beforeAll, beforeEach, expect, inject, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { bootDev } from '../../src/runtime/full.ts';

const decode = (key: 'lake_island_page_ssr_b64') => decodeURIComponent(escape(atob(inject(key))));

const seen = { connects: 0, disconnects: 0 };

beforeAll(() => {
	customElements.define(
		'x-lake-probe',
		class extends HTMLElement {
			connectedCallback() {
				seen.connects++;
				if (!this.querySelector('i[data-own]'))
					this.insertAdjacentHTML('beforeend', '<i data-own>own</i>');
			}
			disconnectedCallback() {
				seen.disconnects++;
			}
		}
	);
});

beforeEach(() => {
	document.body.innerHTML = '';
	seen.connects = 0;
	seen.disconnects = 0;
});

test('an island’s hydrate keeps its lake’s custom elements connected and their own light DOM theirs', async () => {
	document.body.innerHTML = decode('lake_island_page_ssr_b64');
	const island = document.querySelector('ogygia-region')!;
	const lake = island.querySelector('ogygia-region[wake="none"]')!;
	const probe = lake.querySelector('x-lake-probe')!;
	expect(probe, 'the fixture holds a lake with a custom element').not.toBeNull();
	expect(seen).toEqual({ connects: 1, disconnects: 0 });
	const warns: string[] = [];
	const real_warn = console.warn;
	console.warn = (...a: unknown[]) => warns.push(a.map(String).join(' '));
	try {
		bootDev();
		await userEvent.click(island.querySelector('span')!);
		await expect.poll(() => island.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
		expect(seen, 'never left the document').toEqual({ connects: 1, disconnects: 0 });
		expect(island.querySelector('x-lake-probe')).toBe(probe);
		expect(probe.querySelector('b')!.textContent).toBe('frozen');
		expect(probe.querySelector('i[data-own]'), 'its runtime’s own node stays').not.toBeNull();
		expect(island.hasAttribute('data-og-recovered')).toBe(false);
		expect(island.hasAttribute('data-og-healed'), 'a lake’s inside is no drift').toBe(false);
		expect(warns.filter((w) => /hydration_(mismatch|discarded)/.test(w))).toEqual([]);
	} finally {
		console.warn = real_warn;
	}
});
