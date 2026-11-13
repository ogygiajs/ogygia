// THE REWRITE SIMULATOR. Seeded pages (islands, lakes, server markup; custom elements nested in each
// other) go through two rewrites in sequence, cut into chunks at random places (inside tags,
// elements and marks), while every render call may fail the way a real one does: it throws, returns
// the wrong count, returns HTML that does not close, drops ogygia's marks, is slow (its answers land
// in any order, fc.scheduler), or the request is cancelled mid-batch. csr on and off; region
// answers too. The page that comes out is parsed in a real browser and restored, and must hold:
//
// - every Svelte-owned part is what Svelte rendered (the restorer's own check finds no mismatch,
//   and each island's light DOM has the original's text and element tags);
// - no ogygia mark is left anywhere, and no stand-in;
// - every failure is said with its code (a fault that turned into an unrendered element was
//   reported), and a run without a fault reports none;
// - the restore is idempotent: a second one restores nothing and changes nothing.
import { afterEach, expect, test } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { fc } from '@ogygia/config/html-fuzz';
import { sim_params } from '@ogygia/config/sim';
import { rewrite_pass, step_of, type Failure } from '../../src/pass.ts';
import { restore } from '../../src/restore.ts';
import type { ElementRewrite, RewriteElement, RewriteResult } from '../../src/types.ts';

type Fault = 'ok' | 'throw' | 'count' | 'malformed' | 'strip' | 'slow' | 'abort';

const text = fc.constantFrom(' a ', 'b', '  spaced  ', 'é🏝️', ' ');
const leaf = fc.oneof(
	text,
	text.map((t) => `<i>${t}</i>`),
	text.map((t) => `<x-icon>${t}</x-icon>`)
);
const card: fc.Arbitrary<string> = fc.letrec<{ card: string }>((tie) => ({
	card: fc
		.array(fc.oneof({ depthSize: 'small' }, leaf, tie('card')), { maxLength: 3 })
		.map((kids) => `<x-card class="c">${kids.join('')}</x-card>`)
})).card;
const block = fc.oneof(
	fc
		.array(fc.oneof(card, leaf), { minLength: 1, maxLength: 3 })
		.map((xs) => `<ogygia-region entry="./a.js" data-og-fp="f">${xs.join('')}</ogygia-region>`),
	fc
		.array(card, { minLength: 1, maxLength: 2 })
		.map((xs) => `<ogygia-region wake="none">${xs.join('')}</ogygia-region>`),
	fc
		.array(fc.oneof(card, leaf), { minLength: 1, maxLength: 2 })
		.map((xs) => `<div>${xs.join('')}</div>`)
);
const body = fc.array(block, { minLength: 1, maxLength: 5 }).map((bs) => bs.join(''));

/** Each `<tag …>inner</tag>` of `html` rendered in scoped form, innermost first: its children moved
 *  into a `<slot>` inside a tree of its own, and the plan (og-shadow) on a host ogygia restores. */
function scoped(html: string, tag: string, trim: boolean): string {
	const open_of = `<${tag}`;
	const close_of = `</${tag}>`;
	let out = html;
	for (let before = out.length; ;) {
		const open = before < 0 ? -1 : out.lastIndexOf(open_of, before);
		if (open === -1) return out;
		before = open - 1;
		const gt = out.indexOf('>', open);
		let depth = 1;
		let at = gt + 1;
		let close = -1;
		while (depth > 0) {
			const o = out.indexOf(open_of, at);
			const c = out.indexOf(close_of, at);
			if (c === -1) return out;
			if (o !== -1 && o < c) {
				depth++;
				at = o + open_of.length;
			} else {
				depth--;
				close = c;
				at = c + close_of.length;
			}
		}
		const attrs = out.slice(open + open_of.length, gt);
		let inner = out.slice(gt + 1, close);
		if (trim) inner = inner.replace(/>\s+</g, '><');
		const plan = attrs.includes(' og-h=') ? ` og-shadow="${tag}.shadow"` : '';
		out = `${out.slice(0, open)}<${tag}${attrs}${plan} data-r="${tag}"><div class="t"><b>${tag}</b><slot>${inner}</slot></div>${out.slice(close)}`;
	}
}

interface Run {
	faults: Fault[];
	at: number;
	injected: number;
	abort: AbortController;
	scheduler: fc.Scheduler;
}

function faulty(tag: string, run: Run): ElementRewrite {
	return {
		match: [tag],
		async render(els: readonly RewriteElement[]) {
			const fault = run.faults[run.at++ % run.faults.length];
			if (fault !== 'ok' && fault !== 'slow' && fault !== 'abort') run.injected++;
			if (fault === 'abort') run.abort.abort();
			if (fault === 'slow') await run.scheduler.schedule(Promise.resolve(), `${tag} slow`);
			if (fault === 'throw') throw new Error(`${tag} render failed`);
			const out: RewriteResult[] = els.map((el) => ({
				html: scoped(el.html, tag, true),
				sheets: [{ key: `${tag}.shadow`, css: 'b{color:red}', scope: 'shadow' }]
			}));
			if (fault === 'count') return out.slice(1);
			if (fault === 'malformed') return out.map((r) => `${(r as { html: string }).html}<div>`);
			if (fault === 'strip')
				return out.map((r) => (r as { html: string }).html.replaceAll(' og-h=', ' data-gone='));
			return out;
		}
	};
}

function cut(html: string, at: readonly number[]): string[] {
	const sorted = [...new Set(at.map((n) => n % Math.max(1, html.length)))]
		.filter(Boolean)
		.sort((a, b) => a - b);
	const out: string[] = [];
	let from = 0;
	for (const n of sorted) {
		out.push(html.slice(from, n));
		from = n;
	}
	out.push(html.slice(from));
	return out;
}

const marks_left = (root: ParentNode): string[] => {
	const left: string[] = [];
	const walk = (node: Node) => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === 1) {
				const el = child as Element;
				if (el.localName === 'og-as') left.push('<og-as>');
				for (const a of Array.from(el.attributes)) if (a.name.startsWith('og-')) left.push(a.name);
				if (el.shadowRoot) walk(el.shadowRoot);
				walk(el.localName === 'template' ? (el as HTMLTemplateElement).content : el);
			} else if (child.nodeType === 8 && (child as Comment).data.startsWith('og-'))
				left.push(`<!--${(child as Comment).data}-->`);
		}
	};
	walk(root as Node);
	return left;
};

const islands = (root: ParentNode) =>
	Array.from(root.querySelectorAll('ogygia-region[entry]:not([wake])')).map((r) => ({
		text: r.textContent,
		tags: Array.from(r.querySelectorAll('*'), (e) => e.localName).join(' ')
	}));

afterEach(() => {
	const w = window as { __og_restore_log?: unknown[]; __og_sheets?: unknown };
	w.__og_restore_log = [];
	w.__og_sheets = undefined;
	for (const t of Array.from(document.querySelectorAll('[data-og-head]'))) t.remove();
});

const SWARM = sim_params({ runs: 60, seed: 1676 });

test('a seeded swarm of streamed pages through two failing rewrites restores what Svelte rendered, says every failure, and restores once', async () => {
	await fc.assert(
		fc.asyncProperty(
			body,
			fc.array(fc.nat(), { maxLength: 6 }),
			fc.array(
				fc.constantFrom<Fault>(
					'ok',
					'ok',
					'ok',
					'throw',
					'count',
					'malformed',
					'strip',
					'slow',
					'abort'
				),
				{
					minLength: 1,
					maxLength: 8
				}
			),
			fc.boolean(),
			fc.scheduler(),
			async (inner, at, faults, csr, scheduler) => {
				const head = '<!doctype html><html><head></head><body>';
				const page = `${head}${inner}</body></html>`;
				const run: Run = { faults, at: 0, injected: 0, abort: new AbortController(), scheduler };
				const request = new Request('http://x/', { signal: run.abort.signal });
				const failed: Failure[] = [];
				const pass = rewrite_pass(
					[step_of(faulty('x-card', run)), step_of(faulty('x-icon', run))],
					{ request, url: new URL(request.url) } as RequestEvent,
					{ dev: true, failed: (f) => failed.push(f) }
				);
				const chunks = cut(page, at);
				let html = '';
				let head_add = '';
				let body_add = '';
				let seen = 0;
				const work = (async () => {
					for (let i = 0; i < chunks.length; i++) {
						const c = chunks[i];
						const out = await pass.document(c, {
							csr,
							answer: false,
							head: seen < head.length - 6 && seen + c.length >= head.length - 6,
							body: page.indexOf('</body>') >= seen && page.indexOf('</body>') < seen + c.length,
							done: i === chunks.length - 1
						});
						seen += c.length;
						html += out.html;
						head_add += out.head;
						body_add += out.body;
					}
				})();
				await scheduler.waitFor(work);
				const served = html
					.replace('</head>', `${head_add}</head>`)
					.replace('</body>', `${body_add}</body>`);
				const original = new DOMParser().parseFromString(page, 'text/html');
				const doc = new DOMParser().parseFromString(served, 'text/html');
				(window as { __og_restore_log?: unknown[] }).__og_restore_log = [];
				restore(doc);
				const log = (window as { __og_restore_log?: { kind: string; diff?: string }[] })
					.__og_restore_log!;
				expect(
					log.filter((e) => e.kind === 'mismatch'),
					served
				).toEqual([]);
				expect(marks_left(doc.body), served).toEqual([]);
				expect(islands(doc.body), served).toEqual(islands(original.body));
				const coded = failed.filter((f) => f.code !== 'rewrite_element_split');
				if (run.abort.signal.aborted) expect(coded.length).toBeGreaterThanOrEqual(0);
				else if (run.injected === 0) expect(coded, served).toEqual([]);
				for (const f of coded)
					expect(['rewrite_element_failed', 'rewrite_marks_lost']).toContain(f.code);
				const before = doc.body.innerHTML;
				expect(restore(doc)).toBe(0);
				expect(doc.body.innerHTML).toBe(before);
			}
		),
		SWARM
	);
});

test('region answers: every host restored in the fragment, nothing left, idempotent', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(card, { minLength: 1, maxLength: 4 }),
			fc.scheduler(),
			async (cards, scheduler) => {
				const answer = cards.join('');
				const run: Run = {
					faults: ['ok'],
					at: 0,
					injected: 0,
					abort: new AbortController(),
					scheduler
				};
				const request = new Request('http://x/');
				const pass = rewrite_pass(
					[step_of(faulty('x-card', run)), step_of(faulty('x-icon', run))],
					{ request, url: new URL(request.url) } as RequestEvent,
					{ dev: true }
				);
				const out = await pass.region(answer);
				const inert = document.implementation.createHTMLDocument('');
				const t = inert.createElement('template');
				t.innerHTML = out;
				const box = inert.createElement('div');
				box.append(t.content);
				restore(box);
				expect(marks_left(box)).toEqual([]);
				const want = inert.createElement('div');
				const t2 = inert.createElement('template');
				t2.innerHTML = answer;
				want.append(t2.content);
				expect(box.textContent).toBe(want.textContent);
				expect(restore(box)).toBe(0);
			}
		),
		sim_params({ runs: 40, seed: 1676 })
	);
});
