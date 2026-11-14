import { expect, test } from 'vitest';
import { flushSync, mount, unmount, type Component } from 'svelte';
import LateSwapHost from './fixtures/LateSwapHost.svelte';
import Label from './fixtures/Label.svelte';

type Late = Component<{ load: () => Promise<Component>; props: Record<string, unknown> }>;

export function late_island_loads_once_suite(late: Late): void {
	test('a late island loads its component once: a new load after it rendered is never called', async () => {
		const target = document.body.appendChild(document.createElement('div'));
		const calls: string[] = [];
		const first = (): Promise<Component> => {
			calls.push('first');
			return Promise.resolve(Label as Component);
		};
		const app = mount(LateSwapHost, { target, props: { late, first } }) as {
			swap: (next: () => Promise<Component>) => void;
		};
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		const shown = target.innerHTML;
		expect(target.textContent).toBe('kept');
		app.swap(() => {
			calls.push('second');
			return Promise.resolve(Label as Component);
		});
		flushSync();
		await new Promise((r) => setTimeout(r, 20));
		expect(calls).toEqual(['first']);
		expect(target.innerHTML).toBe(shown);
		await unmount(app);
		target.remove();
	});
}
