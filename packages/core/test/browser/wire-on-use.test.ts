// AN ISLAND'S PROPS CARRY A LIVE VALUE THE BUILD DID NOT PREDICT. The compiler decides at build time
// whether an app ships the wire codec, and it cannot see every value a prop holds: a forwarded
// `children`, a snippet passed as a prop, a spread of `$props()`. When the server encodes such a value
// (an `OgygiaRef`) for a build without the codec, the runtime loads the codec before it reads the
// props, and the island hydrates with the live value.
//
// Its own file: the wire slot is module state shared by a file's tests.
import { expect, inject, test, vi } from 'vitest';
import { from_b64 } from './b64.ts';
import { page } from 'vitest/browser';
import { writable } from 'svelte/store';

// as a build whose marks left `wire` out: the hydrate core installs every feature but the codec
vi.mock('../_stubs/boot.hydrate-features.ts', async () => {
	const [context, live, remote_seeds, seeds] = await Promise.all([
		import('../../src/runtime/context.ts'),
		import('../../src/runtime/live.ts'),
		import('../../src/runtime/remote-seeds.ts'),
		import('../../src/runtime/seeds.ts')
	]);
	return {
		install(): void {
			remote_seeds.install();
			seeds.install();
			live.install();
			context.install();
		}
	};
});

const { bootDev } = await import('../../src/runtime/full.ts');
const { slots } = await import('../../src/runtime/slots.ts');
const { stringify_props } = await import('../../src/server/props-wire.ts');

const HYDRATED = 'ogygia-region[data-hydrated]';

test('an island whose props hold a live value hydrates in a build without the wire codec', async () => {
	expect(slots.wire, 'no codec before the wake').toBeFalsy();
	document.body.innerHTML = from_b64(inject('counter_ssr_b64'));
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
	const { read_region_props } = await import('../../src/runtime/hydrate-core.ts');
	const props = read_region_props(document.querySelector('ogygia-region')!);
	let seen: unknown;
	(props.extra as { subscribe(fn: (v: unknown) => void): () => void }).subscribe((v) => {
		seen = v;
	})();
	expect(seen).toBe(7);
});
