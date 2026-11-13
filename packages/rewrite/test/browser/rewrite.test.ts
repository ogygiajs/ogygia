import { afterEach, expect, test } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { rewrite } from '../../src/index.ts';
import { rewrite_pass, step_of } from '../../src/pass.ts';
import { fake_scoped } from '../fixtures/fake-scoped-render.ts';
import type { ElementRewrite } from '../../src/types.ts';

const SHEET = { key: 'demo-card.shadow', css: 'b{color:rgb(255, 0, 0)}', scope: 'shadow' as const };
const scoped: ElementRewrite = {
	match: 'demo-',
	render: (els) => els.map((el) => ({ html: fake_scoped(el.html), sheets: [SHEET] }))
};
const island = (inner: string) =>
	`<ogygia-region entry="./a.js" data-og-fp="f1">${inner}</ogygia-region>`;

afterEach(() => {
	document.body.innerHTML = '';
	for (const t of Array.from(document.querySelectorAll('[data-og-head]'))) t.remove();
	const w = window as { __og_sheets?: unknown; __og_restore?: unknown };
	w.__og_sheets = undefined;
	w.__og_restore = undefined;
});

test('check(): a region answer restored in a DOM, every host exactly Svelte’s', async () => {
	const r = await rewrite(scoped).check(
		'<demo-card class="own">  Sign in <i title="x">ok</i> </demo-card><demo-link>l</demo-link>'
	);
	expect(r.failed).toEqual([]);
	expect(r.restored).toBe(2);
	expect(r.mismatches).toEqual([]);
	expect(r.dom!.querySelector('[og-h]')).toBeNull();
	const card = r.dom!.querySelector('demo-card')!;
	expect(card.innerHTML).toBe('  Sign in <i title="x">ok</i> ');
	expect(card.shadowRoot!.querySelector('b')!.textContent).toBe('Card title');
});

test('check(): a document, its restored hosts compared with Svelte’s', async () => {
	const r = await rewrite(scoped).check(
		`<!doctype html><html><head></head><body>${island('<demo-card> a <b>b</b> </demo-card>')}</body></html>`,
		{ kind: 'document', csr: false }
	);
	expect(r.mismatches).toEqual([]);
	expect(r.restored).toBe(1);
	expect(r.head.join('')).toContain('data-og-head="demo-card.shadow"');
	expect(r.dom!.querySelector('demo-card')!.innerHTML).toBe(' a <b>b</b> ');
});

test('check(): a render that changes Svelte’s children is named in mismatches', async () => {
	const careless: ElementRewrite = {
		match: 'demo-',
		render: (els) =>
			els.map((el) => ({
				html: fake_scoped(el.html).replace('>ok</i>', '>changed</i>'),
				sheets: [SHEET]
			}))
	};
	const r = await rewrite(careless).check(
		`<!doctype html><html><head></head><body>${island('<demo-card><i>ok</i></demo-card>')}</body></html>`,
		{ kind: 'document' }
	);
	expect(r.mismatches).toHaveLength(1);
	expect(r.mismatches[0]).toContain('ok');
});

test('chunk by chunk: the first chunk’s restorer and each later chunk’s call restore exactly their hosts, sheets found inline', async () => {
	const request = new Request('http://x/');
	const pass = rewrite_pass(
		[step_of(scoped)],
		{ request, url: new URL(request.url) } as RequestEvent,
		{
			dev: false
		}
	);
	const flags = { csr: false, answer: false, head: false, body: false, done: false };
	await pass.document('<html><head></head><body><p>shell</p>', { ...flags, head: true });
	const one = await pass.document(island('<demo-card> one </demo-card>'), flags);
	const two = await pass.document(island('<demo-card> two </demo-card>'), flags);
	const three = await pass.document('<p>no match</p>', flags);
	expect(three.html).toBe('<p>no match</p>');
	for (const part of [one, two]) {
		const range = document.createRange();
		range.selectNode(document.body);
		document.body.append(range.createContextualFragment(part.html));
	}
	const cards = Array.from(document.querySelectorAll('demo-card'));
	expect(cards.map((c) => c.innerHTML)).toEqual([' one ', ' two ']);
	for (const c of cards) {
		expect(c.shadowRoot!.querySelector('b')!.textContent).toBe('Card title');
		expect(getComputedStyle(c.shadowRoot!.querySelector('b')!).color).toBe('rgb(255, 0, 0)');
	}
	expect(document.querySelector('[og-h]')).toBeNull();
});
