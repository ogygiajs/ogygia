// THE REWRITE SIMULATOR. Seeded pages (islands, lakes, server markup; custom elements nested in each
// other, in a `<p>`, in a declarative shadow root) go through two rewrites in sequence, cut into
// chunks at random places (inside tags, elements and marks), while every render call may fail the
// way a real one does: it throws, returns the wrong count, returns HTML that does not close, drops
// ogygia's marks, is slow (its answers land in any order, fc.scheduler), the request is cancelled
// mid-batch, or it leaves an element as it came. csr on and off; region answers too. The page that
// comes out is loaded in a frame of a real browser, its own scripts run where they stand, and must
// hold:
//
// - every Svelte-owned part is what Svelte rendered (the restorer's own check finds no mismatch,
//   and each island's light DOM has the original's text and element tags);
// - no ogygia mark is left anywhere, shadow roots included, and no stand-in; a stand-in paints as
//   its tag until the restore runs;
// - every failure is said with its code (a fault that turned into an unrendered element was
//   reported), and a run without a fault reports none; a run that never failed renders every match;
// - a pass that wrote nothing changes no byte;
// - a page without the first-load mark, swapped in by the router, restores every host it rendered;
// - once the request is cancelled, no render is called and no failure is said;
// - the restore is idempotent: a later one restores nothing and changes nothing.
import { afterEach, expect, test } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { fc } from '@ogygia/config/html-fuzz';
import { sim_params } from '@ogygia/config/sim';
import { rewrite_pass, step_of, type Failure } from '../../src/pass.ts';
import { restore } from '../../src/restore.ts';
import type { ElementRewrite, RewriteElement, RewriteResult } from '../../src/types.ts';

type Fault = 'ok' | 'same' | 'throw' | 'count' | 'malformed' | 'strip' | 'slow' | 'abort';

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
		.map((xs) => `<div>${xs.join('')}</div>`),
	fc
		.array(card, { minLength: 1, maxLength: 2 })
		.map(
			(xs) => `<ogygia-region entry="./a.js" data-og-fp="f"><p>${xs.join('')}</p></ogygia-region>`
		),
	{
		weight: 3,
		arbitrary: fc
			.array(card, { minLength: 1, maxLength: 2 })
			.map(
				(xs) =>
					`<ogygia-region entry="./a.js" data-og-fp="f"><div><template shadowrootmode="open">${xs.join('')}</template></div></ogygia-region>`
			)
	}
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
	late: string[];
	wrote: boolean;
}

const WRITES: ReadonlySet<Fault> = new Set(['ok', 'slow', 'abort', 'strip']);

function faulty(tag: string, run: Run): ElementRewrite {
	return {
		match: [tag],
		async render(els: readonly RewriteElement[]) {
			if (run.abort.signal.aborted) run.late.push(`${tag} rendered`);
			const fault = run.faults[run.at++ % run.faults.length];
			if (fault !== 'ok' && fault !== 'same' && fault !== 'slow' && fault !== 'abort')
				run.injected++;
			if (WRITES.has(fault) && els.length) run.wrote = true;
			if (fault === 'abort') run.abort.abort();
			if (fault === 'slow') await run.scheduler.schedule(Promise.resolve(), `${tag} slow`);
			if (fault === 'throw') throw new Error(`${tag} render failed`);
			if (fault === 'same') return els.map((el) => el.html);
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

const unrendered = (served: string): string[] =>
	Array.from(served.matchAll(/<(x-card|x-icon)(?=[\s>])([^>]*)>/g))
		.filter((m) => !m[2].includes(` data-r="${m[1]}"`))
		.map((m) => `<${m[1]}${m[2]}>`);

const parse_with_shadow_roots = (html: string): Document =>
	(Document as unknown as { parseHTMLUnsafe(html: string): Document }).parseHTMLUnsafe(html);

/** What a router that took this page for an answer would show: unless it says it is a first load,
 *  it is restored and swapped in, so every host its render rendered must come back restored. */
function swapped_unrestored(served: string): string[] {
	const doc = new DOMParser().parseFromString(served, 'text/html');
	if (doc.querySelector('meta[name="ogygia-first-load"]')) return [];
	restore(doc);
	return Array.from(doc.querySelectorAll('[data-r]'))
		.filter((h) => !h.shadowRoot)
		.map((h) => `<${h.localName}> rendered, never restored`);
}

/** Each stand-in that does not paint as its tag would, read right before each restore runs. */
function paint_of(doc: Document, out: string[]): void {
	const view = doc.defaultView!;
	for (const el of Array.from(doc.querySelectorAll('og-as'))) {
		const tag = el.getAttribute('tag') ?? '';
		const real = doc.createElement(tag);
		el.after(real);
		const want = view.getComputedStyle(real).display;
		real.remove();
		const got = view.getComputedStyle(el).display;
		if (got !== want) out.push(`<og-as tag="${tag}"> paints ${got}, its tag ${want}`);
	}
}

let frame: HTMLIFrameElement | null = null;

/** The page as a browser loads it: parsed in a frame, each of its scripts run where it stands. */
async function load(
	served: string
): Promise<{ doc: Document; log: { kind: string }[]; paint: string[] }> {
	const paint: string[] = [];
	(window as { __og_paint?: (d: Document) => void }).__og_paint = (d) => paint_of(d, paint);
	frame?.remove();
	frame = document.createElement('iframe');
	const loaded = new Promise((r) => frame!.addEventListener('load', r, { once: true }));
	frame.srcdoc = served.replaceAll(
		'<script data-og-restore>',
		'<script>parent.__og_paint(document)</script><script data-og-restore>'
	);
	document.body.append(frame);
	await loaded;
	const w = frame.contentWindow as Window & { __og_restore_log?: { kind: string }[] };
	return { doc: frame.contentDocument!, log: w.__og_restore_log ?? [], paint };
}

afterEach(() => {
	frame?.remove();
	frame = null;
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
			fc.oneof(fc.constant([]), {
				weight: 3,
				arbitrary: fc.array(fc.nat(), { minLength: 1, maxLength: 6 })
			}),
			fc.array(
				fc.constantFrom<Fault>(
					'ok',
					'ok',
					'ok',
					'same',
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
				const run: Run = {
					faults,
					at: 0,
					injected: 0,
					abort: new AbortController(),
					scheduler,
					late: [],
					wrote: false
				};
				const request = new Request('http://x/', { signal: run.abort.signal });
				const failed: Failure[] = [];
				const pass = rewrite_pass(
					[step_of(faulty('x-card', run)), step_of(faulty('x-icon', run))],
					{ request, url: new URL(request.url) } as RequestEvent,
					{
						dev: true,
						failed: (f) => {
							if (run.abort.signal.aborted) run.late.push(`${f.code} said`);
							failed.push(f);
						}
					}
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
				if (!run.wrote) expect(served, 'a rewrite that wrote nothing changes no byte').toBe(page);
				if (faults.every((f) => f === 'ok') && failed.length === 0)
					expect(unrendered(served), 'a rewrite that never failed renders every match').toEqual([]);
				expect(swapped_unrestored(served), served).toEqual([]);
				const original = parse_with_shadow_roots(page);
				const { doc, log, paint } = await load(served);
				expect(paint, served).toEqual([]);
				expect(
					log.filter((e) => e.kind === 'mismatch'),
					served
				).toEqual([]);
				expect(marks_left(doc.body), served).toEqual([]);
				expect(islands(doc.body), served).toEqual(islands(original.body));
				const coded = failed.filter((f) => f.code !== 'rewrite_element_split');
				expect(run.late, served).toEqual([]);
				if (!run.abort.signal.aborted && run.injected === 0) expect(coded, served).toEqual([]);
				for (const f of coded)
					expect(['rewrite_element_failed', 'rewrite_marks_lost']).toContain(f.code);
				expect(restore(doc)).toBe(0);
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
					scheduler,
					late: [],
					wrote: false
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
