// An inline island a client navigation created loads its code late (LateIsland.svelte). A load that
// fails (the network, a deploy that removed the file) renders nothing, and must say so, like every
// other island whose code fails to load: island_load_failed.
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import LateIsland from '../../src/LateIsland.svelte';

describe('a late island whose code fails to load', () => {
	it('renders nothing, and says island_load_failed with the error', async () => {
		const said: unknown[][] = [];
		const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
			said.push(a);
		});
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(LateIsland, {
			target,
			props: {
				load: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
				props: {}
			}
		});
		flushSync();
		try {
			await new Promise((r) => setTimeout(r, 20));
			expect(target.innerHTML.replace(/<!---->/g, '')).toBe('');
			const hit = said.find((a) => String(a[0]).includes('island_load_failed'));
			expect(hit).toBeDefined();
			expect((hit![1] as Error).message).toContain('Failed to fetch');
		} finally {
			spy.mockRestore();
			await unmount(app);
			target.remove();
		}
	});
});
