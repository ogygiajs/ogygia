// AN ISLAND'S PROPS CARRY A LIVE VALUE THE BUILD DID NOT PREDICT. The compiler decides at build time
// whether an app ships the wire codec, and it cannot see every value a prop holds: a forwarded
// `children`, a snippet passed as a prop, a spread of `$props()`. When the server encodes such a value
// (an `OgygiaRef`) for a build without the codec, the runtime loads the codec before it reads the
// props, and the island hydrates with the live value.
//
// Its own file: the wire slot is module state shared by a file's tests.
import { expect, inject, test } from 'vitest';
import { page } from 'vitest/browser';
import { writable } from 'svelte/store';
import { bootDev } from '../../src/runtime/full.ts';
import { slots } from '../../src/runtime/slots.ts';
import { stringify_props } from '../../src/server/props-wire.ts';
import { read_region_props } from '../../src/runtime/hydrate-core.ts';

const HYDRATED = 'ogygia-region[data-hydrated]';

test('an island whose props hold a live value hydrates in a build without the wire codec', async () => {
	// as a build whose marks left `wire` out: the hydrate core is in, the codec never installed
	slots.wire = null;
	document.body.innerHTML = decodeURIComponent(escape(atob(inject('counter_ssr_b64'))));
	const sidecar = document.querySelector('script[data-ogygia-props]')!;
	sidecar.textContent = stringify_props({ start: 3, extra: writable(7) }, 'Counter');
	expect(sidecar.textContent).toContain('OgygiaRef');
	const ssr_button = document.querySelector('button');

	bootDev();

	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	await expect.element(page.getByTestId('count')).toHaveTextContent('3');
	expect(document.querySelector('button')).toBe(ssr_button);
	// the store crossed live
	const props = read_region_props(document.querySelector('ogygia-region')!);
	let seen: unknown;
	(props.extra as { subscribe(fn: (v: unknown) => void): () => void }).subscribe((v) => {
		seen = v;
	})();
	expect(seen).toBe(7);
});
