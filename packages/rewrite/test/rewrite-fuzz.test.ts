// THE ROUND TRIP IS EXACT. Any markup, cut into chunks anywhere (inside a tag, an element, a mark,
// a comment), through a rewrite whose render hands every element back as it got it, comes out byte
// for byte as it went in, with nothing added to the head or the body. The same for a region answer.
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { fc, fuzz, html_arb } from '@ogygia/config/html-fuzz';
import { rewrite_pass, step_of } from '../src/pass.ts';
import type { RewriteElement } from '../src/types.ts';

const EVENT = { request: new Request('http://x/'), url: new URL('http://x/') } as RequestEvent;
const identity = (els: readonly RewriteElement[]) => els.map((el) => el.html);

const markup = html_arb({
	tags: [
		'x-a',
		'x-b',
		'x-a-b',
		'div',
		'p',
		'a',
		'li',
		'td',
		'ogygia-region',
		'template',
		'svg',
		'body',
		'script',
		'pre',
		'textarea',
		'og-as'
	],
	attrs: ['class', 'wake', 'endpoint', 'entry', 'shadowrootmode', 'title', 'data-og-head', 'is'],
	values: ['none', 'open', '/e.js', 'a b', 'x-a', '<x-a>', '&amp;'],
	texts: ['  spaced  ', '<x-a>', '</x-a>', 'og-h="0"', '&nbsp;', '<!--og-c 0.0 t-->']
});

const cuts = (html: string) =>
	fc
		.uniqueArray(fc.integer({ min: 1, max: Math.max(1, html.length - 1) }), { maxLength: 6 })
		.map((at) => {
			const sorted = at.filter((n) => n < html.length).sort((a, b) => a - b);
			const out: string[] = [];
			let from = 0;
			for (const n of sorted) {
				out.push(html.slice(from, n));
				from = n;
			}
			out.push(html.slice(from));
			return out;
		});

const TOKEN = '<!--rendered-->';
const beside = (els: readonly RewriteElement[]) => els.map((el) => `${el.html}${TOKEN}`);

async function through(
	chunks: readonly string[],
	csr: boolean,
	answer: boolean,
	render: typeof identity = identity
) {
	const pass = rewrite_pass(
		[step_of({ match: 'x-', render }), step_of({ match: ['x-b'], render })],
		EVENT,
		{ dev: false, failed: () => {} }
	);
	let html = '';
	let added = '';
	for (let i = 0; i < chunks.length; i++) {
		const out = await pass.document(chunks[i], {
			csr,
			answer,
			head: i === 0,
			body: i === chunks.length - 1,
			done: i === chunks.length - 1
		});
		html += out.html;
		added += out.head + out.body;
	}
	return { html, added, region: await pass.region(chunks.join('')) };
}

describe('an identity render', () => {
	for (const [csr, answer] of [
		[false, false],
		[true, false],
		[false, true]
	] as const)
		it(`gives any markup, cut anywhere, back byte for byte (csr ${csr}, answer ${answer})`, async () => {
			const cases: [string, string[]][] = [];
			fuzz(
				markup.chain((html) => cuts(html).map((chunks) => [html, chunks] as [string, string[]])),
				(c) => void cases.push(c),
				{ runs: 300 }
			);
			for (const [html, chunks] of cases) {
				const out = await through(chunks, csr, answer);
				expect(out.html, JSON.stringify(chunks)).toBe(html);
				expect(out.added, JSON.stringify(chunks)).toBe('');
				expect(out.region, html).toBe(html);
			}
		});
});

describe('a render that only adds beside each element', () => {
	for (const [csr, answer] of [
		[false, false],
		[true, false],
		[false, true]
	] as const)
		it(`leaves every other byte as it was: marks, settle and splice undo each other (csr ${csr}, answer ${answer})`, async () => {
			const cases: [string, string[]][] = [];
			fuzz(
				markup.chain((html) => cuts(html).map((chunks) => [html, chunks] as [string, string[]])),
				(c) => void cases.push(c),
				{ runs: 300 }
			);
			for (const [html, chunks] of cases) {
				const out = await through(chunks, csr, answer, beside);
				expect(out.html.replaceAll(TOKEN, ''), JSON.stringify(chunks)).toBe(html);
				expect(out.region.replaceAll(TOKEN, ''), html).toBe(html);
			}
		});
});
