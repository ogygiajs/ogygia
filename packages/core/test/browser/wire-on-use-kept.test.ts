// A KEPT ISLAND TAKES THE NEXT PAGE'S PROPS WHEN THEY CARRY A LIVE VALUE THE BUILD DID NOT PREDICT. A
// kept island (`keep: 'name'`) crosses a navigation as the same node, and the next page's props are
// pushed into it. When those props hold an `OgygiaRef` in a build without the wire codec, the
// runtime loads the codec before it reads them, as a wake does (wire-on-use.test.ts), and the island
// shows the next page's props instead of keeping the old ones.
//
// Its own file: the wire slot is module state shared by a file's tests.
import { expect, inject, test, vi } from 'vitest';
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

const LABEL = '/test/browser/fixtures/Label.svelte';
const HYDRATED = 'ogygia-region[data-hydrated]';

const kept = (body: string, props: Record<string, unknown>) =>
	`<ogygia-region wake="load" entry="${LABEL}" data-ogygia-keep="label">${body}</ogygia-region>` +
	`<script type="application/ogygia-props" data-ogygia-props>${stringify_props(props, 'Label')}\x3C/script>`;

test('a kept island whose next props hold a live value shows them in a build without the wire codec', async () => {
	const meta = document.createElement('meta');
	meta.name = 'ogygia-router';
	document.head.append(meta);
	const body = decodeURIComponent(escape(atob(inject('label_render_b64'))));
	document.body.innerHTML = kept(body, { text: 'one' });

	bootDev();

	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	await expect.element(page.getByTestId('label')).toHaveTextContent('one');
	expect(slots.wire, 'its first props needed no codec').toBeFalsy();
	const live = document.querySelector('ogygia-region')!;
	const p = live.querySelector('p');

	// the next page's copy of the region, in the document the router fetched
	const next_doc = new DOMParser().parseFromString(
		`<!doctype html><body>${kept(body, { text: 'next', extra: writable(7) })}</body>`,
		'text/html'
	);
	const twin = next_doc.querySelector('ogygia-region')!;
	expect(next_doc.querySelector('script')!.textContent).toContain('OgygiaRef');
	(live as Element & { absorbKeptProps(next: Element): void }).absorbKeptProps(twin);
	// (the router drops the incoming copy right after)
	twin.remove();

	await expect.element(page.getByTestId('label')).toHaveTextContent('next');
	expect(live.querySelector('p'), 'the same node').toBe(p);
});
