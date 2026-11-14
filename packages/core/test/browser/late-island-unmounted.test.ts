import { expect, test, vi } from 'vitest';
import { flushSync, mount, unmount, type Component } from 'svelte';
import LateIsland from '../../src/LateIsland.svelte';

test('a late island unmounted before its load fails says nothing: the place it would fill is gone', async () => {
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});
	try {
		const target = document.body.appendChild(document.createElement('div'));
		let fail!: (e: unknown) => void;
		const load = () => new Promise<Component>((_, reject) => (fail = reject));
		const app = mount(LateIsland, { target, props: { load, props: {} } });
		flushSync();
		await unmount(app);
		fail(new Error('the download dropped'));
		await new Promise((r) => setTimeout(r, 20));
		expect(error.mock.calls).toEqual([]);
		target.remove();
	} finally {
		error.mockRestore();
	}
});

test('a late island whose load fails while it is shown says island_load_failed', async () => {
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});
	try {
		const target = document.body.appendChild(document.createElement('div'));
		const load = () => Promise.reject(new Error('the download dropped'));
		const app = mount(LateIsland, { target, props: { load, props: {} } });
		await new Promise((r) => setTimeout(r, 20));
		expect(error.mock.calls.map((c) => String(c[0]))).toEqual([
			expect.stringContaining('island_load_failed')
		]);
		await unmount(app);
		target.remove();
	} finally {
		error.mockRestore();
	}
});
