import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const LABEL = '/test/browser/fixtures/Label.svelte';
const URL_ = '/__ogygia__?id=answer-copy&props=W3t9XQ&exp=9999999999&sig=stub';
const ANSWER = '<p data-testid="label"></p><x-grows-at-connect></x-grows-at-connect>';

customElements.define(
	'x-grows-at-connect',
	class extends HTMLElement {
		connectedCallback() {
			if (!this.firstChild) this.append(document.createElement('i'));
		}
	}
);

let real_fetch: typeof fetch;
beforeEach(() => {
	real_fetch = globalThis.fetch;
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (!url.includes('id=answer-copy')) return real_fetch(input, init);
		return new Response(ANSWER, { status: 200, headers: { 'content-type': 'text/html' } });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = real_fetch;
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	_reset();
});

test('a hydrating hole compares its island against the answer as the server sent it, not as a custom element in it changed itself at insertion', async () => {
	const said: string[] = [];
	const note = (...args: unknown[]) => void said.push(args.map(String).join(' '));
	vi.spyOn(console, 'warn').mockImplementation(note);
	vi.spyOn(console, 'error').mockImplementation(note);
	document.body.innerHTML = `<ogygia-region render="defer" when="load" wake="load" entry="${LABEL}" endpoint="${URL_}"><p>loading</p></ogygia-region>`;
	bootDev();
	await expect
		.poll(() => said.some((s) => s.includes('ownership_conflict')), { timeout: 5_000 })
		.toBe(true);
});
