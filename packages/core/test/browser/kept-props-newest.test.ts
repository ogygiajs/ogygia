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
type Kept = Element & { absorbKeptProps(next: Element): void };

const kept = (body: string, props: Record<string, unknown>) =>
	`<ogygia-region wake="load" entry="${LABEL}" data-ogygia-keep="label">${body}</ogygia-region><script type="application/ogygia-props" data-ogygia-props>${stringify_props(props, 'Label')}\x3C/script>`;
const twin_of = (html: string) =>
	new DOMParser()
		.parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
		.querySelector('ogygia-region')!;

test('a kept island’s newer props win over older ones still waiting for the wire codec', async () => {
	const meta = document.createElement('meta');
	meta.name = 'ogygia-router';
	document.head.append(meta);
	const body = decodeURIComponent(escape(atob(inject('label_render_b64'))));
	document.body.innerHTML = kept(body, { text: 'one' });
	bootDev();
	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	const live = document.querySelector('ogygia-region') as Kept;

	live.absorbKeptProps(twin_of(kept(body, { text: 'older', extra: writable(7) })));
	live.absorbKeptProps(twin_of(kept(body, { text: 'newer' })));
	await expect.element(page.getByTestId('label')).toHaveTextContent('newer');
	await expect.poll(() => slots.wire, { timeout: 10_000 }).toBeTruthy();
	await new Promise((r) => setTimeout(r, 100));
	await expect.element(page.getByTestId('label')).toHaveTextContent('newer');
});

test('a kept island whose next props cannot be read keeps the props it has', async () => {
	const body = decodeURIComponent(escape(atob(inject('label_render_b64'))));
	const live = document.querySelector('ogygia-region') as Kept;
	const twin = twin_of(
		`<ogygia-region wake="load" entry="${LABEL}" data-ogygia-keep="label">${body}</ogygia-region><script type="application/ogygia-props" data-ogygia-props>{not props\x3C/script>`
	);
	expect(() => live.absorbKeptProps(twin)).not.toThrow();
	await expect.element(page.getByTestId('label')).toHaveTextContent('newer');
});
