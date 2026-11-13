// A REGION TAKES AT MOST ONE KNOWN COPY, HOWEVER OFTEN ITS RENDER READS THE ANSWER. With server-delta
// on, a router navigation names the regions the page already shows (`x-ogygia-known`), and each
// region of that fingerprint takes one copy and skips its content. Region.svelte reads its skip
// answer more than once (the template, the devtools record): a copy taken per read would leave the
// region that took it rendered in full, and its twin with nothing left to take.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { set_request_event_stub } from './_stubs/server.request-event.ts';

// (the realm stub takes no copy: the real claim, over the stub's fingerprint)
const claim = vi.hoisted(() => ({ real: (_fp: string): boolean => false }));
vi.mock('ogygia:server/region-endpoint', async (stub) => ({
	...((await stub()) as object),
	reuse_known_region: (fp: string) => claim.real(fp)
}));
// (the devtools record is a second read of the answer; its compile gate, on before the import)
(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
claim.real = (await import('../src/server/region-endpoint.ts')).reuse_known_region;
const { default: Region } = await import('../src/Region.svelte');
const { default: Tiny } = await import('./_fixtures/Tiny.svelte');

const region = Region as unknown as Component<Record<string, unknown>>;
const island = { __mode: 'island', __entry: '/islands/tiny.js', __component: Tiny, __props: {} };

const flag = globalThis as { __OGYGIA_SERVER_DELTA__?: boolean };
afterEach(() => {
	set_request_event_stub(null);
	delete flag.__OGYGIA_SERVER_DELTA__;
});

/** Two twins of one island, in one render. */
function render_twins(): string {
	const Host = ((renderer: unknown) => {
		(region as unknown as (r: unknown, p: unknown) => void)(renderer, island);
		(region as unknown as (r: unknown, p: unknown) => void)(renderer, island);
	}) as unknown as Component;
	return render(Host).body;
}

describe('server-delta: one known copy, one region', () => {
	it('two twins and one known copy: one skips, one renders in full', () => {
		const fp = /data-og-fp="([0-9a-f]+)"/.exec(render(region, { props: island }).body)?.[1];
		expect(fp, 'the island has a fingerprint').toBeTruthy();

		flag.__OGYGIA_SERVER_DELTA__ = true;
		const request = new Request('https://app.test/', {
			headers: { 'x-ogygia-spa': '1', 'x-ogygia-known': fp! }
		});
		set_request_event_stub(() => ({ request }));

		const html = render_twins();
		expect(html.match(/<ogygia-region/g)?.length, 'two regions').toBe(2);
		expect(html.match(/data-tiny/g)?.length, 'one rendered in full, its twin skipped').toBe(1);
	});

	it('two twins and two known copies: both skip', () => {
		const fp = /data-og-fp="([0-9a-f]+)"/.exec(render(region, { props: island }).body)?.[1];
		flag.__OGYGIA_SERVER_DELTA__ = true;
		const request = new Request('https://app.test/', {
			headers: { 'x-ogygia-spa': '1', 'x-ogygia-known': `${fp},${fp}` }
		});
		set_request_event_stub(() => ({ request }));

		const html = render_twins();
		expect(html.match(/<ogygia-region/g)?.length, 'two regions').toBe(2);
		expect(html.match(/data-tiny/g), 'both skipped').toBeNull();
	});
});
