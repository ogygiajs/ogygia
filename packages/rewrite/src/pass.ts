import type { RequestEvent } from '@sveltejs/kit';
import type { HtmlPass } from '@ogygia/core/plugin';
import { closeSafe, escapeAttr } from '@ogygia/core/plugin/utils';
import { MarkupCursor, OG_HEAD, OG_RESTORE, OG_STAND_INS } from '@ogygia/core/internal/instruments';
import { DEV } from 'esm-env';
import {
	check_script,
	closes_all,
	localize_marks,
	mark,
	mark_with,
	remap,
	restored_ids,
	root_attr,
	settle,
	STAND_IN_CSS,
	type MarkRecord
} from './reversible.ts';
import { restore, restore_adopt } from './restore.ts';
import { matcher, scan, scan_state, union, type Matcher, type ScanState } from './scan.ts';
import { OgygiaError, warn } from './messages.ts';
import type {
	ElementRewrite,
	PageRewrite,
	RewriteContext,
	RewriteElement,
	RewriteKind,
	RewriteSheet
} from './types.ts';

/** A rewrite as the pass runs it. */
export type Step =
	| { page: null; match: Matcher; render: ElementRewrite['render'] }
	| { page: PageRewrite['page']; match: null; render: null };

export function step_of(def: ElementRewrite | PageRewrite): Step {
	if ('page' in def && typeof def.page === 'function')
		return { page: def.page.bind(def), match: null, render: null };
	const el = def as ElementRewrite;
	return { page: null, match: matcher(el.match), render: el.render.bind(el) };
}

/** A failure the pass recovered from: the code it is said with, the element, the reason. */
export interface Failure {
	code: 'rewrite_element_failed' | 'rewrite_marks_lost' | 'rewrite_element_split';
	name: string;
	error: string;
}

/** How a pass reports: `dev` (default: the build's), and `failed` to take each recovered failure
 *  instead of saying it (`.check()` lists them). */
export interface PassOptions {
	dev?: boolean;
	failed?: (f: Failure) => void;
}

/** @internal The restorer, inline (./restore.ts: self-contained, so its source runs as is): restores
 *  the document now, and stays as `__og_restore` / `__og_restore_adopt` for later chunks, hole
 *  answers and router swaps. Its text closed-safe like every inline code ogygia writes
 *  (test/restorer-inline-safe.test.ts). */
export const RESTORER_SCRIPT: string = `<script ${OG_RESTORE}>${closeSafe(`(function(){var r=${restore.toString()};window.__og_restore=r;window.__og_restore_adopt=${restore_adopt.toString()};r(document)})()`)}</script>`;
/** @internal A later chunk's restore: the hosts not restored yet (`lite`: none inside a declarative
 *  shadow root), or every host in the document when the chunk put one inside such a root. */
export const RESTORE_CALL: string = `<script ${OG_RESTORE}>__og_restore(document,1)</script>`;
export const RESTORE_CALL_FULL: string = `<script ${OG_RESTORE}>__og_restore(document)</script>`;

const FIRST_LOAD = '<meta name="ogygia-first-load">';

interface Unit {
	el: string;
	cur: string;
	record: MarkRecord | null;
	sheets: RewriteSheet[] | null;
	changed: boolean;
}

interface Target {
	unit: Unit;
	start: number;
	end: number;
	element: RewriteElement;
	back: (html: string) => string;
}

interface Rendered {
	html: string;
	sheets: readonly RewriteSheet[] | null;
}

interface Out {
	html: string;
	head: string;
	body: string;
}

function css_text(css: string): string {
	return css.replace(/<\/(style)/gi, '<\\/$1');
}

function sheet_tag(s: RewriteSheet): string {
	const key = escapeAttr(s.key);
	return s.scope === 'shadow'
		? `<template ${OG_HEAD}="${key}"><style>${css_text(s.css)}</style></template>`
		: `<style ${OG_HEAD}="${key}">${css_text(s.css)}</style>`;
}

function valid_sheets(v: unknown): readonly RewriteSheet[] | null | false {
	if (v === undefined) return null;
	if (!Array.isArray(v)) return false;
	for (const s of v as unknown[]) {
		const o = s as Partial<RewriteSheet> | null;
		if (
			typeof o !== 'object' ||
			o === null ||
			typeof o.key !== 'string' ||
			o.key === '' ||
			typeof o.css !== 'string' ||
			(o.scope !== 'page' && o.scope !== 'shadow')
		)
			return false;
	}
	return v as RewriteSheet[];
}

function message_of(thrown: unknown): string {
	return thrown instanceof Error ? thrown.message : String(thrown);
}

function count_error(out: unknown, n: number): string {
	return `render returned ${Array.isArray(out) ? out.length : typeof out} result(s) for ${n} element(s)`;
}

class Response {
	readonly steps: readonly Step[];
	readonly any: Matcher | null;
	readonly paged: boolean;
	readonly event: RequestEvent;
	readonly dev: boolean;
	readonly failed: (f: Failure) => void;
	readonly said = new Set<string>();
	readonly sent = new Set<string>();
	readonly scan: ScanState = scan_state(false);
	ids = 0;
	restorer = false;
	head_open = true;
	stand_ins = false;
	first_load = false;
	buffer: string[] | null = null;

	constructor(steps: readonly Step[], event: RequestEvent, opts: PassOptions) {
		this.steps = steps;
		const matchers: Matcher[] = [];
		for (const s of steps) if (s.match) matchers.push(s.match);
		this.any = matchers.length ? union(matchers) : null;
		this.paged = steps.some((s) => s.page !== null);
		this.event = event;
		this.dev = opts.dev ?? DEV;
		this.failed = opts.failed ?? ((f) => this.say(f));
	}

	say(f: Failure): void {
		const key = `${f.code} ${f.name}`;
		if (this.said.has(key)) return;
		this.said.add(key);
		if (f.code === 'rewrite_element_failed')
			warn('rewrite_element_failed', { name: f.name, error: f.error });
		else if (f.code === 'rewrite_marks_lost') warn('rewrite_marks_lost', { name: f.name });
		else if (this.dev) warn('rewrite_element_split', { name: f.name });
	}

	ctx(kind: RewriteKind, csr: boolean): RewriteContext {
		const event = this.event;
		return { kind, csr, url: event.url, event, signal: event.request.signal };
	}
}

async function render_one(
	render: ElementRewrite['render'],
	el: RewriteElement,
	ctx: RewriteContext
): Promise<{ ok: unknown } | { error: string }> {
	try {
		const out = await render([el], ctx);
		return Array.isArray(out) && out.length === 1 ? { ok: out[0] } : { error: count_error(out, 1) };
	} catch (thrown) {
		return { error: message_of(thrown) };
	}
}

async function render_targets(
	render: ElementRewrite['render'],
	targets: readonly Target[],
	ctx: RewriteContext,
	res: Response
): Promise<(Rendered | null)[]> {
	const unique: RewriteElement[] = [];
	const index = new Map<string, number>();
	const slot: number[] = [];
	for (const t of targets) {
		let i = index.get(t.element.html);
		if (i === undefined) {
			index.set(t.element.html, (i = unique.length));
			unique.push(t.element);
		}
		slot.push(i);
	}
	let results: unknown[] | null = null;
	try {
		const out = await render(unique, ctx);
		if (Array.isArray(out) && out.length === unique.length) results = out;
		// oxlint-disable-next-line ogygia/no-silent-failures -- a failed batch is retried one element at a time below, and each element that still fails is said with its code
	} catch {
		results = null;
	}
	if (ctx.signal.aborted) return targets.map(() => null);
	const outcome: (Rendered | Failure)[] = [];
	if (results === null) {
		const each = await Promise.all(unique.map((el) => render_one(render, el, ctx)));
		if (ctx.signal.aborted) return targets.map(() => null);
		for (let i = 0; i < unique.length; i++) {
			const e = each[i];
			outcome[i] =
				'ok' in e
					? judge(unique[i], e.ok)
					: { code: 'rewrite_element_failed', name: unique[i].name, error: e.error };
		}
	} else for (let i = 0; i < unique.length; i++) outcome[i] = judge(unique[i], results[i]);
	for (const o of outcome) if ('code' in o) res.failed(o);
	return slot.map((i) => {
		const o = outcome[i];
		return 'code' in o ? null : o;
	});
}

function judge(el: RewriteElement, out: unknown): Rendered | Failure {
	let html: unknown = out;
	let sheets: readonly RewriteSheet[] | null | false = null;
	if (typeof out === 'object' && out !== null) {
		html = (out as { html?: unknown }).html;
		sheets = valid_sheets((out as { sheets?: unknown }).sheets);
	}
	const name = el.name;
	if (typeof html !== 'string')
		return { code: 'rewrite_element_failed', name, error: 'its result has no html string' };
	if (sheets === false)
		return {
			code: 'rewrite_element_failed',
			name,
			error: 'a sheet needs a key, its css, and a scope of page or shadow'
		};
	if (!closes_all(html))
		return {
			code: 'rewrite_element_failed',
			name,
			error: 'its html does not close everything it opens'
		};
	if (el.restored) {
		const kept = restored_ids(html);
		for (const id of restored_ids(el.html))
			if (!kept.has(id)) return { code: 'rewrite_marks_lost', name, error: 'og-h dropped' };
	}
	return { html, sheets };
}

function outer_mark(html: string): { html: string; attr: string } | null {
	const a = root_attr(html, 'og-c');
	if (a === null) return null;
	let from = a.start;
	while (from > 0 && /\s/.test(html[from - 1])) from--;
	return {
		html: `${html.slice(0, from)}${html.slice(a.end)}`,
		attr: ` ${html.slice(a.start, a.end)}`
	};
}

function with_outer_mark(html: string, attr: string): string {
	for (const at = new MarkupCursor(html); at.next();)
		if (at.kind === 1) return `${html.slice(0, at.ne)}${attr}${html.slice(at.ne)}`;
	return html;
}

function starts_restored(html: string): boolean {
	return root_attr(html, 'og-h') !== null;
}

async function run_steps(
	units: readonly Unit[],
	res: Response,
	ctx: RewriteContext,
	whole: { kind: RewriteKind; csr: boolean } | null
): Promise<void> {
	for (const step of res.steps) {
		if (step.page) {
			for (const u of units) await run_page(step.page, u, ctx, res);
			continue;
		}
		const targets: Target[] = [];
		for (const unit of units) {
			const state = scan_state(whole === null || whole.kind === 'region');
			for (const span of scan(unit.cur, step.match, state, whole?.csr ?? false).spans) {
				const raw = unit.cur.slice(span.start, span.end);
				const outer = outer_mark(raw);
				const local = localize_marks(outer ? outer.html : raw);
				targets.push({
					unit,
					start: span.start,
					end: span.end,
					back: outer ? (h) => with_outer_mark(local.back(h), outer.attr) : local.back,
					element: { name: span.name, html: local.html, restored: starts_restored(local.html) }
				});
			}
		}
		if (!targets.length) continue;
		const out = await render_targets(step.render, targets, ctx, res);
		for (let t = targets.length - 1; t >= 0; t--) {
			const r = out[t];
			if (!r || (r.html === targets[t].element.html && !r.sheets?.length)) continue;
			const { unit, start, end, back } = targets[t];
			unit.cur = unit.cur.slice(0, start) + back(r.html) + unit.cur.slice(end);
			unit.changed = true;
			if (r.sheets?.length) (unit.sheets ??= []).unshift(...r.sheets);
		}
	}
}

async function run_page(
	page: NonNullable<Step['page']>,
	unit: Unit,
	ctx: RewriteContext,
	res: Response
): Promise<void> {
	const before = unit.cur;
	let out: unknown;
	try {
		out = await page(before, ctx);
	} catch (thrown) {
		return page_failed(res, ctx, message_of(thrown), thrown);
	}
	if (ctx.signal.aborted) return;
	if (typeof out !== 'string')
		return page_failed(res, ctx, `page returned ${typeof out}, not a string`, null);
	const kept = restored_ids(out);
	for (const id of restored_ids(before))
		if (!kept.has(id)) return page_failed(res, ctx, "it dropped ogygia's og-h marks", null);
	unit.cur = out;
	unit.changed = true;
}

function page_failed(res: Response, ctx: RewriteContext, error: string, thrown: unknown): void {
	const e = new OgygiaError('rewrite_page_failed', { kind: ctx.kind, error });
	if (res.dev) throw e;
	console.error(e, thrown ?? '');
}

function sheets_for(unit: Unit, res: Response, head: string[] | null): string {
	if (!unit.sheets) return '';
	let inline = '';
	for (const s of unit.sheets) {
		if (res.sent.has(s.key)) continue;
		res.sent.add(s.key);
		if (head && res.head_open) head.push(sheet_tag(s));
		else inline += sheet_tag(s);
	}
	return inline;
}

interface UnitOut {
	html: string;
	restored: number;
	stand_ins: number;
	full: boolean;
	check: Record<string, string> | null;
	first_load: boolean;
}

function settle_unit(unit: Unit, res: Response, all: boolean): UnitOut {
	const record = unit.record;
	if (!unit.changed || record === null)
		return {
			html: unit.changed ? unit.cur : unit.el,
			restored: 0,
			stand_ins: 0,
			full: false,
			check: null,
			first_load: false
		};
	const s = settle(unit.cur, record, { dev: res.dev });
	const offset = res.ids;
	res.ids += record.hosts.size;
	const html = offset === 0 ? s.html : remap(s.html, (id) => id + offset);
	let check: Record<string, string> | null = null;
	if (s.check) {
		check = {};
		for (const k in s.check) check[Number(k) + offset] = s.check[k];
	}
	let first_load = false;
	if (!all) for (const h of record.hosts.values()) if (!h.planned) first_load = true;
	return {
		html,
		restored: s.planned,
		stand_ins: s.stand_ins,
		full: s.planned > 0 && html.indexOf('shadowrootmode') !== -1,
		check,
		first_load
	};
}

async function rewrite_chunk(
	html: string,
	res: Response,
	page: { csr: boolean; answer: boolean; body: boolean }
): Promise<Out | null> {
	const scanned = scan(html, res.any!, res.scan, page.csr);
	if (scanned.split)
		res.failed({
			code: 'rewrite_element_split',
			name: scanned.split,
			error: 'it did not close before its chunk ended'
		});
	if (!scanned.spans.length) return null;
	const all = page.answer;
	const units: Unit[] = scanned.spans.map((span) => {
		const el = html.slice(span.start, span.end);
		const marked = mark_with(el, { doc: false, csr: false, all, owned: span.owned });
		return {
			el,
			cur: marked ? marked.html : el,
			record: marked ? marked.record : null,
			sheets: null,
			changed: false
		};
	});
	await run_steps(units, res, res.ctx('document', page.csr), null);
	const head: string[] = [];
	const out: string[] = [];
	let pos = 0;
	let restored = 0;
	let stand_ins = 0;
	let full = false;
	let check: Record<string, string> | null = null;
	let first_load = false;
	let lead_at = -1;
	for (let i = 0; i < units.length; i++) {
		const span = scanned.spans[i];
		const s = settle_unit(units[i], res, all);
		out.push(html.slice(pos, span.start));
		if (lead_at === -1) lead_at = out.push('') - 1;
		if (units[i].changed) out.push(sheets_for(units[i], res, head));
		out.push(s.html);
		pos = span.end;
		restored += s.restored;
		stand_ins += s.stand_ins;
		full ||= s.full;
		first_load ||= s.first_load;
		if (s.check) Object.assign((check ??= {}), s.check);
	}
	out.push(html.slice(pos));
	const lead: string[] = [];
	if (stand_ins && !res.stand_ins) {
		res.stand_ins = true;
		(res.head_open ? head : lead).push(`<style ${OG_STAND_INS}>${STAND_IN_CSS}</style>`);
	}
	if (first_load && !res.first_load) {
		res.first_load = true;
		(res.head_open ? head : lead).push(FIRST_LOAD);
	}
	let body = '';
	if (restored || stand_ins) {
		body = (check ? check_script(check) : '') + restore_script(res, full);
		if (page.body === false) {
			out.push(body);
			body = '';
		}
	}
	out[lead_at] = lead.join('');
	return { html: out.join(''), head: head.join(''), body };
}

function restore_script(res: Response, full: boolean): string {
	if (!res.restorer) {
		res.restorer = true;
		return RESTORER_SCRIPT;
	}
	return full ? RESTORE_CALL_FULL : RESTORE_CALL;
}

async function rewrite_whole(
	html: string,
	res: Response,
	kind: RewriteKind,
	csr: boolean,
	answer: boolean
): Promise<Out> {
	const marked = mark(html, kind, csr, answer);
	const unit: Unit = {
		el: html,
		cur: marked ? marked.html : html,
		record: marked ? marked.record : null,
		sheets: null,
		changed: false
	};
	await run_steps([unit], res, res.ctx(kind, csr), { kind, csr });
	if (!unit.changed) return { html, head: '', body: '' };
	const region = kind === 'region';
	const head: string[] = [];
	const lead = sheets_for(unit, res, region ? null : head);
	if (!marked) return { html: lead + unit.cur, head: head.join(''), body: '' };
	const s = settle(unit.cur, marked.record, { dev: res.dev });
	if (region)
		return { html: lead + s.html + (s.check ? check_script(s.check) : ''), head: '', body: '' };
	head.push(...s.head);
	if (s.stand_ins) head.push(`<style ${OG_STAND_INS}>${STAND_IN_CSS}</style>`);
	if (!answer)
		for (const h of marked.record.hosts.values())
			if (!h.planned) {
				head.push(FIRST_LOAD);
				break;
			}
	const body =
		s.planned || s.stand_ins ? (s.check ? check_script(s.check) : '') + RESTORER_SCRIPT : '';
	return { html: s.html, head: head.join(''), body };
}

/**
 * THE REWRITES OF ONE REQUEST, as ogygia runs them (`HtmlPass`). A document goes chunk by chunk:
 * a chunk with no match goes out as it came; in one with matches, each outermost match is marked on
 * its own (its marks from 0), every rewrite renders its matches in one call, and each is settled,
 * its ids moved past the ones before it. A page rewrite holds the document and rewrites it whole. A
 * region answer is rewritten whole.
 */
export function rewrite_pass(
	steps: readonly Step[],
	event: RequestEvent,
	opts: PassOptions = {}
): HtmlPass {
	const res = new Response(steps, event, opts);
	return {
		async document(html, page) {
			if (res.paged) {
				(res.buffer ??= []).push(html);
				if (!page.done) return { html: '', head: '', body: '' };
				const doc = res.buffer.join('');
				res.buffer = null;
				return rewrite_whole(doc, res, 'document', page.csr, page.answer);
			}
			const out = res.any ? await rewrite_chunk(html, res, page) : null;
			if (page.head) res.head_open = false;
			return out ?? { html, head: '', body: '' };
		},
		async region(html) {
			return (await rewrite_whole(html, res, 'region', false, true)).html;
		}
	};
}
