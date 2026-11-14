import { expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RegionSwapHost from '../browser/fixtures/RegionSwapHost.svelte';

type Host = { swap: (html: string) => void; to_lake: () => void };

test('a held region follows a new value of the same kind: it renders in place', async () => {
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(RegionSwapHost, { target }) as Host;
	flushSync();
	expect(target.textContent).toBe('one');
	app.swap('<b>two</b>');
	flushSync();
	expect(target.textContent).toBe('two');
	await unmount(app);
	target.remove();
});

test("a region's mode is read once: a later `__mode` does not turn it into another kind", async () => {
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(RegionSwapHost, { target }) as Host;
	flushSync();
	app.to_lake();
	flushSync();
	expect(target.querySelector('ogygia-region')).toBeNull();
	expect(target.textContent).toBe('one');
	await unmount(app);
	target.remove();
});
