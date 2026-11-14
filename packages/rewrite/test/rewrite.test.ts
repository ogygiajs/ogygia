import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
	call_render,
	RESTORE_CALL,
	RESTORER_SCRIPT,
	rewrite_pass,
	step_of,
	type Failure
} from '../src/pass.ts';
import { rewrite } from '../src/index.ts';
import type {
	ElementRewrite,
	PageRewrite,
	RewriteContext,
	RewriteElement,
	RewriteResult
} from '../src/types.ts';
import { fake_scoped } from './fixtures/fake-scoped-render.ts';

const event_of = (signal?: AbortSignal) => {
	const request = new Request('http://x/p', signal ? { signal } : undefined);
	return { request, url: new URL(request.url) } as RequestEvent;
};
const island = (inner: string) =>
	`<ogygia-region entry="./a.js" data-og-fp="f1">${inner}</ogygia-region>`;
const doc = (body: string) =>
	`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const SHEET = { key: 'demo-card.shadow', css: 'b{color:red}', scope: 'shadow' as const };

function scoped(seen?: RewriteElement[][]): ElementRewrite {
	return {
		match: 'demo-',
		render(elements) {
			seen?.push([...elements]);
			return elements.map((el) => ({ html: fake_scoped(el.html), sheets: [SHEET] }));
		}
	};
}

type Page = { csr?: boolean; answer?: boolean; head?: boolean; body?: boolean; done?: boolean };
function chunked(defs: (ElementRewrite | PageRewrite)[], event = event_of()) {
	const failed: Failure[] = [];
	const pass = rewrite_pass(defs.map(step_of), event, {
		dev: false,
		failed: (f) => failed.push(f)
	});
	const chunk = (html: string, p: Page = {}) =>
		pass.document(html, {
			csr: p.csr ?? false,
			answer: p.answer ?? false,
			head: p.head ?? html.includes('</head>'),
			body: p.body ?? html.includes('</body>'),
			done: p.done ?? true
		});
	return { pass, chunk, failed };
}

describe('element rewrites: what goes to render', () => {
	it('only the outermost match goes, with marks numbered from 0, and equal elements render once', async () => {
		const seen: RewriteElement[][] = [];
		const { chunk } = chunked([scoped(seen)]);
		const card = '<demo-card class="own"><i>ok</i><demo-link>l</demo-link></demo-card>';
		await chunk(doc(island(card + card)));
		expect(seen).toHaveLength(1);
		expect(seen[0]).toHaveLength(1);
		expect(seen[0][0].name).toBe('demo-card');
		expect(seen[0][0].restored).toBe(true);
		expect(seen[0][0].html.startsWith('<demo-card og-h="0" class="own">')).toBe(true);
		expect(seen[0][0].html).toContain('og-h="1"');
	});

	it('the ids of a response keep counting past each element, so marks never collide', async () => {
		const { chunk } = chunked([scoped()]);
		const out = await chunk(doc(island('<demo-card>a</demo-card><demo-card>b</demo-card>')));
		expect(out.html).toContain('og-h="0"');
		expect(out.html).toContain('og-h="1"');
	});

	it('text that spells a mark is text: moving ids never touches it, and render sees it as written (found by the fuzz)', async () => {
		const seen: RewriteElement[][] = [];
		const { chunk } = chunked([scoped(seen)]);
		const text = 'see og-h="0" and og-c="0.1"';
		const out = await chunk(
			doc(`<demo-card>a</demo-card><demo-card title='og-h="0"'>${text}</demo-card>`)
		);
		expect(seen[0][1].html).toContain(text);
		expect(seen[0][1].html).toContain(`title='og-h="0"'`);
		expect(out.html).toContain(text);
		expect(out.html).toContain(`title='og-h="0"'`);
	});

	it('a page with no match goes out byte for byte, render is never called, and no restorer ships', async () => {
		const render = vi.fn(() => []);
		const { chunk } = chunked([{ match: 'demo-', render }]);
		const page = doc(island('<p>no custom elements</p><x-other>x</x-other>'));
		expect(await chunk(page)).toEqual({ html: page, head: '', body: '' });
		expect(render).not.toHaveBeenCalled();
	});

	it('a render the page around its element would restructure goes out as a stand-in: a <div> in the page’s <p>, an <a> in the page’s <a> (the restore lab e2e)', async () => {
		const { chunk } = chunked([scoped()]);
		const out = await chunk(
			doc(
				island(
					'<p>Buy <demo-card>now</demo-card></p> <a href="#x"><demo-link>Go</demo-link></a><div><demo-card>block</demo-card></div>'
				)
			)
		);
		expect(out.html).toContain('<og-as class="card sc-demo-card" tag="div"');
		expect(out.html).toContain('tag="a"');
		expect(out.html.match(/<og-as /g)).toHaveLength(2);
		expect(out.head).toContain('og-stand-ins');
	});

	it('a custom element outside Svelte-owned markup is rendered, not restored', async () => {
		const seen: RewriteElement[][] = [];
		const { chunk } = chunked([scoped(seen)]);
		const out = await chunk(doc('<demo-card>server</demo-card>'));
		expect(seen[0][0].restored).toBe(false);
		expect(out.html).toContain('Card title');
		expect(out.html).not.toContain('og-h');
		expect(out.body).toBe('');
		expect(out.head).toContain('ogygia-first-load');
	});

	it('the context carries kind, csr, url, event and a signal that fires when the request is cancelled', async () => {
		let got: RewriteContext | null = null;
		const ac = new AbortController();
		const event = event_of(ac.signal);
		const { chunk } = chunked(
			[
				{
					match: ['demo-card'],
					render(els, ctx) {
						got = ctx;
						return els.map((e) => e.html);
					}
				}
			],
			event
		);
		await chunk(doc('<demo-card>a</demo-card>'), { csr: true });
		expect(got).toEqual({
			kind: 'document',
			csr: true,
			url: event.url,
			event,
			signal: expect.any(AbortSignal)
		});
		expect(got!.signal.aborted).toBe(false);
		ac.abort();
		expect(got!.signal.aborted).toBe(true);
	});
});

describe('element rewrites: the restore', () => {
	it('the chunk that restored something carries the restorer before </body>; its sheets go to the head', async () => {
		const { chunk } = chunked([scoped()]);
		const out = await chunk(doc(island('<demo-card>a</demo-card>')));
		expect(out.body).toBe(RESTORER_SCRIPT);
		expect(out.head).toBe(
			'<template data-og-head="demo-card.shadow"><style>b{color:red}</style></template>'
		);
		expect(out.html).toContain('og-shadow="demo-card.shadow"');
	});

	it('a later chunk: its sheet inline at first use, once per key, and one restore call at its end', async () => {
		const { chunk } = chunked([scoped()]);
		await chunk(doc(island('<demo-card>a</demo-card>')), { done: false });
		const later = await chunk(island('<demo-card>b</demo-card><demo-card>c</demo-card>'));
		expect(later.head).toBe('');
		expect(later.body).toBe('');
		expect(later.html.split('data-og-head="demo-card.shadow"')).toHaveLength(1);
		expect(later.html.endsWith(RESTORE_CALL)).toBe(true);
		const fresh = chunked([scoped()]);
		await fresh.chunk(doc('<p>x</p>'), { done: false });
		const first = await fresh.chunk(island('<demo-card>b</demo-card>'));
		expect(first.html.indexOf('data-og-head="demo-card.shadow"')).toBeLessThan(
			first.html.indexOf('<demo-card')
		);
		expect(first.html.endsWith(RESTORER_SCRIPT)).toBe(true);
	});

	it('a chunk that ends inside a region or a tag carries no script: the restore waits for a chunk that ends where one may go', async () => {
		const { chunk } = chunked([scoped()]);
		await chunk(doc('<p>x</p>').replace('</body></html>', ''), { done: false });
		const open = '<ogygia-region entry="./a.js"><demo-card>a</demo-card>';
		const inside = await chunk(open, { done: false });
		expect(inside.html).not.toContain('<script');
		const mid = await chunk('</ogygia-region><p title="x', { done: false });
		expect(mid.html).not.toContain('<script');
		const after = await chunk('">y</p>', { done: false });
		expect(after.html).toBe(`">y</p>${RESTORER_SCRIPT}`);
	});

	for (const at of ['<ogygia-region entry', '<ogygia-region', '<'])
		it(`a region whose start tag is cut by a chunk boundary (after "${at}") still owns its elements (found by the rewrite sim)`, async () => {
			const seen: RewriteElement[][] = [];
			const { chunk } = chunked([scoped(seen)]);
			const shell = doc('').replace('</body></html>', '');
			const page = `${shell}${island('<demo-card>a</demo-card>')}</body></html>`;
			const cut = shell.length + at.length;
			await chunk(page.slice(0, cut), { done: false });
			await chunk(page.slice(cut));
			expect(seen.flat().map((e) => e.restored)).toEqual([true]);
		});

	for (const [match, at] of [
		['demo-', '<'],
		['demo-', '<dem'],
		[['demo-card'], '<demo-ca'],
		[(name: string) => name === 'demo-card', '<demo'],
		[(name: string) => name === 'demo-card', '<demo-']
	] as const)
		it(`a matched element whose start tag a chunk boundary cuts (after "${at}", in a chunk with no match before it) is said as split, as one its chunk ends inside (found by the rewrite sim)`, async () => {
			const seen: RewriteElement[][] = [];
			const { chunk, failed } = chunked([{ ...scoped(seen), match }]);
			const shell = doc('').replace('</body></html>', '');
			const page = `${shell}<div><demo-card>a</demo-card></div></body></html>`;
			const cut = shell.length + '<div>'.length + at.length;
			const first = await chunk(page.slice(0, cut), { done: false });
			const second = await chunk(page.slice(cut));
			expect(first.html + second.html).toBe(page);
			expect(seen).toEqual([]);
			expect(failed.map((f) => `${f.code} ${f.name}`)).toEqual(['rewrite_element_split demo-card']);
		});

	it('a chunk-1 meta or sheet never lands inside an island: the first-load mark goes before the element it is for (found by the rewrite sim)', async () => {
		const { chunk } = chunked([scoped()]);
		await chunk(doc('').replace('</body></html>', ''), { done: false });
		const out = await chunk(
			`${island('<demo-card>a</demo-card>')}<div><demo-card>b</demo-card></div>`
		);
		const meta = out.html.indexOf('ogygia-first-load');
		expect(meta).toBeGreaterThan(out.html.indexOf('</ogygia-region>'));
	});

	it('the last chunk carries a restore still waiting, wherever it ends', async () => {
		const { chunk } = chunked([scoped()]);
		await chunk(doc('<p>x</p>').replace('</body></html>', ''), { done: false });
		await chunk('<ogygia-region entry="./a.js"><demo-card>a</demo-card>', { done: false });
		const last = await chunk('</ogygia-region><p title="x');
		expect(last.html.endsWith(RESTORER_SCRIPT)).toBe(true);
	});

	it('an element split across chunks goes out unrendered, said once, and the rest is read after it', async () => {
		const render = vi.fn((els: readonly RewriteElement[]) => els.map((e) => fake_scoped(e.html)));
		const { chunk, failed } = chunked([{ match: 'demo-', render }]);
		const head = doc('').replace('</body></html>', '');
		const one = await chunk(`${head}<demo-card>a <b>`, { done: false });
		expect(one.html).toBe(`${head}<demo-card>a <b>`);
		const two = await chunk('half</b></demo-card><demo-card>whole</demo-card>');
		expect(two.html.startsWith('half</b></demo-card>')).toBe(true);
		expect(two.html).toContain('whole</slot>');
		expect(render).toHaveBeenCalledTimes(1);
		expect(failed).toEqual([
			{ ok: false, code: 'rewrite_element_split', name: 'demo-card', error: expect.any(String) }
		]);
	});
});

describe('element rewrites: failures cost only the element', () => {
	let said: unknown[][];
	beforeEach(() => {
		said = [];
		vi.spyOn(console, 'warn').mockImplementation((...a) => said.push(a));
	});
	afterEach(() => vi.restoreAllMocks());

	const page = doc(island('<demo-card>good</demo-card><demo-link>bad</demo-link>'));
	const picky = (bad: (el: RewriteElement) => unknown): ElementRewrite => ({
		match: 'demo-',
		render(els) {
			if (els.length > 1) throw new Error('batch down');
			return els.map((el) =>
				el.name === 'demo-link' ? (bad(el) as RewriteResult) : fake_scoped(el.html)
			);
		}
	});

	for (const [what, bad, code] of [
		[
			'throws',
			() => {
				throw new Error('boom');
			},
			'rewrite_element_failed'
		],
		['returns no html', () => ({ sheets: [] }), 'rewrite_element_failed'],
		['returns html that does not close', () => '<demo-link><div>', 'rewrite_element_failed'],
		[
			'drops the marks',
			(el: RewriteElement) => el.html.replace(/ og-[a-z]+="[^"]*"/g, ''),
			'rewrite_marks_lost'
		],
		[
			'returns a bad sheet',
			() => ({ html: '<demo-link></demo-link>', sheets: [{ key: '' }] }),
			'rewrite_element_failed'
		]
	] as const)
		it(`a failed batch is retried one element at a time; one that ${what} goes out as ogygia rendered it (${code})`, async () => {
			const { chunk, failed } = chunked([picky(bad as (el: RewriteElement) => unknown)]);
			const out = await chunk(page);
			expect(out.html).toContain('<demo-link>bad</demo-link>');
			expect(out.html).toContain('Card title');
			expect(failed.map((f) => [f.code, f.name])).toEqual([[code, 'demo-link']]);
		});

	it('a batch with the wrong count is retried one at a time', async () => {
		const render = vi.fn((els: readonly RewriteElement[]) =>
			els.length > 1 ? [] : els.map((e) => fake_scoped(e.html))
		);
		const { chunk, failed } = chunked([{ match: 'demo-', render }]);
		const out = await chunk(page);
		expect(render).toHaveBeenCalledTimes(3);
		expect(out.html).toContain('sc-demo-link');
		expect(failed).toEqual([]);
	});

	it('a cancelled request: the batch is shipped as is, never retried, nothing said', async () => {
		const ac = new AbortController();
		const render = vi.fn(async (_els: readonly RewriteElement[]) => {
			ac.abort();
			throw new Error('cancelled');
		});
		const { chunk, failed } = chunked([{ match: 'demo-', render }], event_of(ac.signal));
		const out = await chunk(page);
		expect(out).toEqual({ html: page, head: '', body: '' });
		expect(render).toHaveBeenCalledTimes(1);
		expect(failed).toEqual([]);
	});

	it('a request cancelled while the elements are retried one at a time: shipped as is, nothing said, and no element’s render starts after the cancel (found by the long rewrite sim)', async () => {
		const ac = new AbortController();
		const render = vi.fn(async (els: readonly RewriteElement[]) => {
			if (els.length > 1) throw new Error('batch down');
			ac.abort();
			throw new Error('cancelled');
		});
		const { chunk, failed } = chunked([{ match: 'demo-', render }], event_of(ac.signal));
		const out = await chunk(page);
		expect(out).toEqual({ html: page, head: '', body: '' });
		expect(render.mock.calls.map((c) => c[0].length)).toEqual([2, 1]);
		expect(failed).toEqual([]);
	});

	it('a request cancelled during the first rewrite: the second never renders, and nothing is written', async () => {
		const ac = new AbortController();
		const first: ElementRewrite = {
			match: ['x-faq'],
			render(els) {
				ac.abort();
				return els.map((el) => el.html.replace('<x-faq', '<x-faq data-faq'));
			}
		};
		const second = vi.fn((els: readonly RewriteElement[]) => els.map((e) => fake_scoped(e.html)));
		const { chunk, failed } = chunked(
			[first, { match: 'demo-', render: second }],
			event_of(ac.signal)
		);
		const html = doc(island('<x-faq>q</x-faq><demo-card>a</demo-card>'));
		const out = await chunk(html);
		expect(out).toEqual({ html, head: '', body: '' });
		expect(second).not.toHaveBeenCalled();
		expect(failed).toEqual([]);
	});

	it('a later chunk of a cancelled request goes out as it came, never rendered', async () => {
		const ac = new AbortController();
		const render = vi.fn((els: readonly RewriteElement[]) => els.map((e) => fake_scoped(e.html)));
		const { chunk, failed } = chunked([{ match: 'demo-', render }], event_of(ac.signal));
		await chunk(doc('<demo-card>a</demo-card>').replace('</body></html>', ''), { done: false });
		ac.abort();
		const later = '<demo-card>b</demo-card></body></html>';
		expect(await chunk(later)).toEqual({ html: later, head: '', body: '' });
		expect(render).toHaveBeenCalledTimes(1);
		expect(failed).toEqual([]);
	});

	it('rule_rewrite_after_cancel: a render called after the request was cancelled is said with the rule’s code', async () => {
		const ac = new AbortController();
		ac.abort();
		const ctx = { signal: ac.signal } as RewriteContext;
		await call_render((els) => els.map((e) => e.html), [], ctx);
		expect(said.map((a) => String(a[0])).join('\n')).toContain('rule_rewrite_after_cancel');
	});

	it('production says each failure with its code, once per response and element name', async () => {
		const pass = rewrite_pass(
			[
				step_of(
					picky(() => {
						throw new Error('boom');
					})
				)
			],
			event_of(),
			{ dev: false }
		);
		const flags = { csr: false, answer: false, head: true, body: true, done: false };
		await pass.document(page, flags);
		await pass.document(page, { ...flags, head: false });
		const lines = said.map((a) => String(a[0]));
		expect(lines.filter((l) => l.includes('rewrite_element_failed'))).toHaveLength(1);
	});
});

describe('buggify points: each way a render fails, drawn by the simulator', () => {
	const platform = globalThis as { buggify?: (point: string) => boolean };
	const on = (...points: string[]) => {
		platform.buggify = (p) => points.includes(p);
	};
	afterEach(() => {
		delete platform.buggify;
	});
	const page = doc(island('<demo-card>one</demo-card><demo-link>two</demo-link>'));

	it('rewrite.render-count: a batch one result short is retried one at a time, and an element whose own answer is short goes out as ogygia rendered it', async () => {
		on('rewrite.render-count');
		const seen: RewriteElement[][] = [];
		const { chunk, failed } = chunked([scoped(seen)]);
		const out = await chunk(page);
		expect(seen.map((s) => s.length)).toEqual([2, 1, 1]);
		expect(out.html).toBe(page);
		expect(failed.map((f) => [f.code, f.name, f.error])).toEqual([
			['rewrite_element_failed', 'demo-card', 'render returned 0 result(s) for 1 element(s)'],
			['rewrite_element_failed', 'demo-link', 'render returned 0 result(s) for 1 element(s)']
		]);
	});

	it('rewrite.render-malformed: a result that does not close what it opens goes out as ogygia rendered it', async () => {
		on('rewrite.render-malformed');
		const { chunk, failed } = chunked([scoped()]);
		const out = await chunk(page);
		expect(out.html).toBe(page);
		expect(failed.map((f) => [f.code, f.error])).toEqual([
			['rewrite_element_failed', 'its html does not close everything it opens'],
			['rewrite_element_failed', 'its html does not close everything it opens']
		]);
	});

	it('rewrite.render-strips-marks: a result without the og-h of a host ogygia restores goes out as ogygia rendered it', async () => {
		on('rewrite.render-strips-marks');
		const { chunk, failed } = chunked([scoped()]);
		const out = await chunk(page);
		expect(out.html).toBe(page);
		expect(failed.map((f) => [f.code, f.name])).toEqual([
			['rewrite_marks_lost', 'demo-card'],
			['rewrite_marks_lost', 'demo-link']
		]);
	});

	it('rewrite.chunk-split: a chunk read as two, cut inside an element, ships that element unrendered and says so', async () => {
		on('rewrite.chunk-split');
		const render = vi.fn((els: readonly RewriteElement[]) => els.map((e) => fake_scoped(e.html)));
		const { chunk, failed } = chunked([{ match: 'demo-', render }]);
		await chunk(doc('').replace('</body></html>', ''), { done: false });
		const body = '<demo-card>a long enough card to hold the middle</demo-card>';
		const out = await chunk(body, { head: false, body: false });
		expect(out.html).toBe(body);
		expect(render).not.toHaveBeenCalled();
		expect(failed.map((f) => [f.code, f.name])).toEqual([['rewrite_element_split', 'demo-card']]);
	});
});

describe('several rewrites', () => {
	it('run in order on one marking: the second sees the first one’s output, marks intact', async () => {
		const seen: RewriteElement[][] = [];
		const outer: ElementRewrite = {
			match: ['x-faq'],
			render: (els) =>
				els.map((el) =>
					el.html
						.replace('<x-faq', '<x-faq data-faq')
						.replace('</x-faq>', '<demo-card>made</demo-card></x-faq>')
				)
		};
		const { chunk } = chunked([outer, scoped(seen)]);
		const out = await chunk(doc(island('<x-faq><demo-card>q</demo-card></x-faq>')));
		expect(seen[0].map((e) => [e.html.startsWith('<demo-card og-h="0"'), e.restored])).toEqual([
			[true, true],
			[false, false]
		]);
		expect(out.html).toContain('data-faq');
		expect(out.body).toBe(RESTORER_SCRIPT);
	});
});

describe('region answers', () => {
	it('every host is restored; sheets go inline for the runtime to hoist', async () => {
		const { pass } = chunked([scoped()]);
		const out = await pass.region('<demo-card>a</demo-card>');
		expect(out.startsWith('<template data-og-head="demo-card.shadow">')).toBe(true);
		expect(out).toContain('og-h="0"');
		expect(out).not.toContain('<script');
	});
});

describe('the page form', () => {
	it('holds the document until its last chunk and rewrites it whole', async () => {
		const page = vi.fn((html: string) => html.replace('<title>t</title>', '<title>T</title>'));
		const { chunk } = chunked([{ page }]);
		const a = doc('<p>x</p>');
		expect(await chunk(a.slice(0, 20), { done: false })).toEqual({ html: '', head: '', body: '' });
		const out = await chunk(a.slice(20));
		expect(out.html).toBe(a.replace('<title>t</title>', '<title>T</title>'));
		expect(page).toHaveBeenCalledTimes(1);
	});

	it('a page function that throws: production sends the document as ogygia rendered it, said as rewrite_page_failed', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { chunk } = chunked([
			{
				page: () => {
					throw new Error('down');
				}
			}
		]);
		const a = doc('<p>x</p>');
		expect((await chunk(a)).html).toBe(a);
		expect(String(err.mock.calls[0][0])).toContain('rewrite_page_failed');
		vi.restoreAllMocks();
	});

	it('a request cancelled while the page function ran: the document goes out as ogygia rendered it', async () => {
		const ac = new AbortController();
		const { chunk } = chunked(
			[
				{
					page: (html: string) => {
						ac.abort();
						return html.replace('<p>x</p>', '<p>late</p>');
					}
				}
			],
			event_of(ac.signal)
		);
		const a = doc('<p>x</p>');
		expect((await chunk(a)).html).toBe(a);
	});

	it('dev throws it', async () => {
		const pass = rewrite_pass(
			[
				step_of({
					page: () => {
						throw new Error('down');
					}
				})
			],
			event_of(),
			{ dev: true }
		);
		await expect(
			pass.document(doc(''), { csr: false, answer: false, head: true, body: true, done: true })
		).rejects.toThrow(/rewrite_page_failed/);
	});

	it('.html(str) runs the page function on a plain string, outside any request', async () => {
		const rw = rewrite({ page: (html, ctx) => `${html}:${ctx.kind}:${ctx.csr}` });
		expect(await rw.html('a')).toBe('a:document:false');
	});
});

describe('.check()', () => {
	it('lists failures, counts restored hosts, and has no DOM in node', async () => {
		const rw = rewrite({
			match: 'demo-',
			render: (els) =>
				els.map((el) => (el.name === 'demo-link' ? '<demo-link>' : fake_scoped(el.html)))
		});
		const r = await rw.check('<demo-card>a</demo-card><demo-link>b</demo-link>');
		expect(r.failed).toEqual([
			{ name: 'demo-link', error: expect.stringContaining('rewrite_element_failed') }
		]);
		expect(r.restored).toBe(1);
		expect(r.dom).toBeNull();
		expect(r.mismatches).toEqual([]);
	});
});
