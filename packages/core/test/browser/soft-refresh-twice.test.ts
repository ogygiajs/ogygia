import { afterEach, beforeEach, expect, test } from 'vitest';
import { observe } from '@ogygia/machine';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { invalidate_all } from '../../src/runtime/router-nav.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';
import { TEST_MARK_ATTR } from './_response-mark.ts';

const real_fetch = window.fetch;
const home = location.href;

const page = (answer: string) =>
	`<!doctype html><html><head><meta name="ogygia-router" content="plain"><meta name="soft-answer" content="${answer}"><title>page ${answer}</title><script type="application/x-runtime-stand-in" data-ogygia-runtime${TEST_MARK_ATTR}>\x3C/script></head><body><p>${answer}</p><script type="application/ogygia-page" data-og-format="json"${TEST_MARK_ATTR}>${JSON.stringify({ url: home, data: { answer } })}\x3C/script></body></html>`;

/** Each page fetch, answered when the test says. */
const asked: Array<(answer: string) => void> = [];

beforeEach(() => {
	link_boot();
	install_morph();
	const marker = document.createElement('meta');
	marker.name = 'ogygia-router';
	document.head.append(marker);
	document.title = 'page first';
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.fetch = () =>
		new Promise<Response>((resolve) => {
			asked.push((answer) =>
				resolve(
					new Response(page(answer), { status: 200, headers: { 'content-type': 'text/html' } })
				)
			);
		});
});
afterEach(() => {
	window.fetch = real_fetch;
	asked.length = 0;
	for (const el of document.head.querySelectorAll('script[data-ogygia-runtime]')) el.remove();
});

test('a soft refresh started while one is in flight takes over: only the later answer is merged in', async () => {
	const steps: string[] = [];
	const off = observe((name, from, to) => {
		if (name === 'soft refresh') steps.push(`${from?.kind} -> ${to?.kind}`);
	});
	try {
		const first = invalidate_all();
		await expect.poll(() => asked.length).toBe(1);
		const second = invalidate_all();
		await expect.poll(() => asked.length).toBe(2);

		asked[0]!('older');
		await first;
		expect(document.title).toBe('page first');
		expect(steps).toEqual(['idle -> refreshing', 'refreshing -> refreshing']);

		asked[1]!('newer');
		await second;
	} finally {
		off();
	}
	expect(document.title).toBe('page newer');
	expect(document.head.querySelector('meta[name="soft-answer"]')?.getAttribute('content')).toBe(
		'newer'
	);
	expect((page_state.data as { answer?: string }).answer).toBe('newer');
	expect(steps).toEqual(['idle -> refreshing', 'refreshing -> refreshing', 'refreshing -> idle']);
});
