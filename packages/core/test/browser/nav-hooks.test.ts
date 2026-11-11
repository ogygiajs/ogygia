// `beforeNavigate` / `afterNavigate` as a component sees them (src/runtime/nav-hooks.ts): a
// registration made in a component is let go when the component is destroyed; one made outside a
// component stands, and its unsubscribe is the caller's.
import { expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { bind_to_component } from '../../src/runtime/nav-hooks.ts';
import NavHookProbe from './fixtures/NavHookProbe.svelte';

test('a registration made in a component is let go when the component is destroyed', () => {
	const off = vi.fn();
	const target = document.createElement('div');
	const app = mount(NavHookProbe, { target, props: { off } });
	flushSync(); // (its effects run, as they do once a mounted island's turn ends)
	expect(off).not.toHaveBeenCalled();
	void unmount(app);
	expect(off).toHaveBeenCalledTimes(1);
});

test('a component mounted on every visit leaves no registration behind', () => {
	const offs = [vi.fn(), vi.fn(), vi.fn()];
	for (const off of offs) {
		const app = mount(NavHookProbe, { target: document.createElement('div'), props: { off } });
		flushSync();
		void unmount(app);
	}
	for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
});

test('outside a component the registration stands, and its unsubscribe is handed back', () => {
	const off = vi.fn();
	expect(bind_to_component(off)).toBe(off);
	expect(off).not.toHaveBeenCalled();
});
