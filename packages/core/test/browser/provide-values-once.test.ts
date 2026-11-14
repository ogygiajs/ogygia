import { expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ProvideSwapHost from './fixtures/ProvideSwapHost.svelte';

test('a <Provide> reads its values once: new values after it rendered do not reach its children', async () => {
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(ProvideSwapHost, { target }) as { swap: (probe: string) => void };
	flushSync();
	expect(target.textContent).toBe('first');
	app.swap('second');
	flushSync();
	expect(target.textContent).toBe('first');
	expect(target.querySelector('script')).toBeNull();
	await unmount(app);
	target.remove();
});
