// A `wake` the trigger vocabulary does not hold (a typo, or a value an app computed at runtime) is
// read by the one trigger parser (src/contract/trigger.ts) as every schedule reads one: the region
// wakes on load. It is never taken for a media query that can never match.
import { beforeEach, expect, inject, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';

const decode = (key: 'counter_ssr_b64') => decodeURIComponent(escape(atob(inject(key))));

beforeEach(() => {
	document.body.innerHTML = '';
});

test('an island whose wake is not a trigger wakes on load, not never', async () => {
	document.body.innerHTML = decode('counter_ssr_b64').replace('wake="load"', 'wake="visable"');
	const region = document.querySelector('ogygia-region')!;
	bootDev();
	await expect.poll(() => region.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
});
