import {
	find_unscoped,
	unscoped_finding,
	type UnscopedStyles
} from '@ogygia/core/internal/instruments';
import { tool_fetch, tool_made } from '@ogygia/core/internal/instruments';
import {
	OGYGIA_DEVTOOLS_HOST,
	OGYGIA_RCSS,
	OGYGIA_REGION_CSS,
	paint_blocker
} from '@ogygia/core/internal/instruments';

export interface SheetRow {
	/** the file name, or `inline <style>` */
	label: string;
	href: string | null;
	rules: number;
	/** decoded bytes: the response's (resource timing) or the inline text's */
	bytes: number;
	/** the browser waited on it before the first paint (resource timing's own verdict) */
	blocking: boolean;
	/** rules whose selectors match nothing on the page now (null until checked) */
	unmatched: number | null;
	/** their text's size, a stand-in for the bytes they cost */
	unmatched_bytes: number | null;
	/** a region / router stylesheet ogygia linked */
	ogygia: boolean;
}

export interface StylesReport {
	sheets: SheetRow[];
	rules: number;
	bytes: number;
	unmatched: number;
	unmatched_bytes: number;
	/** examples of selectors that match nothing, biggest rules first */
	examples: string[];
	unscoped: (UnscopedStyles & { sheet: string })[];
	/** sheets whose rules could not be read (another origin without CORS) */
	unreadable: number;
}

export interface StylesFinding {
	code: string;
	severity: 'warn' | 'info';
	message: string;
	fix?: string;
}

const STATES = [
	':hover',
	':focus-visible',
	':focus-within',
	':focus',
	':active',
	':visited',
	':target',
	':open',
	':popover-open',
	':modal',
	':user-invalid',
	':user-valid',
	':autofill'
];

/** Split a selector list on its top-level commas (`:is(a, b)` stays whole). */
export function split_selectors(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < list.length; i++) {
		const c = list[i];
		if (c === '(' || c === '[') depth++;
		else if (c === ')' || c === ']') depth--;
		else if (c === ',' && depth === 0) {
			out.push(list.slice(from, i).trim());
			from = i + 1;
		}
	}
	out.push(list.slice(from).trim());
	return out.filter(Boolean);
}

/** A selector with its pseudo-elements (`::before`, `::part(x)`, cut to the next space or
 *  combinator) and momentary states (`:hover`, `:focus`, whole names only) taken off, ready to try
 *  against the document. A compound that lost everything (`a > :hover`) leaves what is before it.
 *  `''` when nothing is left to match (a bare `::selection`): that one counts as used. */
export function matchable(sel: string): string {
	let s = sel;
	let at = s.indexOf('::');
	while (at !== -1) {
		let end = at + 2;
		let depth = 0;
		while (end < s.length) {
			const c = s[end];
			if (c === '(') depth++;
			else if (c === ')') depth--;
			else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~' || c === ','))
				break;
			end++;
		}
		s = s.slice(0, at) + s.slice(end);
		at = s.indexOf('::');
	}
	for (const st of STATES) {
		let i = s.indexOf(st);
		while (i !== -1) {
			const next = s[i + st.length];
			if (next === undefined || !(next === '-' || (next >= 'a' && next <= 'z')))
				s = s.slice(0, i) + s.slice(i + st.length);
			else i += st.length;
			i = s.indexOf(st, i);
		}
	}
	s = s.trim();
	while (s.endsWith('>') || s.endsWith('+') || s.endsWith('~')) s = s.slice(0, -1).trim();
	return s;
}

function file_of(href: string): string {
	const path = href.split('?')[0].split('#')[0];
	return path.slice(path.lastIndexOf('/') + 1) || href;
}

function own_sheet(node: Element | null): boolean {
	const id = node?.getAttribute('data-vite-dev-id');
	return (
		!!id &&
		(id.includes('ogygia') || id.includes('/devtools/src/devtools/')) &&
		id.includes('/devtools/')
	);
}

function styles_the_panel(
	rules: CSSRuleList,
	doc: Document,
	panel: ShadowRoot | null | undefined
): boolean {
	if (!panel) return false;
	let in_panel = false;
	let stop = false;
	each_style_rule(rules, (rule) => {
		if (stop) return;
		for (const part of split_selectors((rule as CSSStyleRule).selectorText)) {
			const m = matchable(part);
			if (!m) continue;
			try {
				if (doc.querySelector(m)) {
					stop = true;
					in_panel = false;
					return;
				}
				if (panel.querySelector(m)) in_panel = true;
				// oxlint-disable-next-line ogygia/no-silent-failures -- a selector this browser cannot query matches nothing
			} catch {}
		}
	});
	return in_panel;
}

type Walk = (rule: CSSRule) => void;
function each_style_rule(list: CSSRuleList, fn: Walk) {
	for (let i = 0; i < list.length; i++) {
		const r = list[i];
		if ('selectorText' in r) fn(r);
		const inner = (r as CSSGroupingRule).cssRules;
		if (inner && inner.length) each_style_rule(inner, fn);
	}
}

/**
 * Read the page's stylesheets as the browser holds them: each one's rules (inside `@media`,
 * `@supports` and nested blocks too), its size, and whether it held the first paint. A dev
 * server's injected `<style>` is named by its file.
 *
 * Devtools' own styles never show: the sheets a dev server injects for its components (from the
 * package, or its source in the workspace), and in a build a linked sheet whose rules match only
 * inside the panel's shadow root (one the page uses too is kept).
 *
 * `match: true` also tries every selector against the document, with states and pseudo-elements
 * taken off ({@link matchable}). A nested rule's `&` and a selector this browser cannot query (a
 * vendor pseudo) count as used. Content that appears later (a menu, a dialog, a region not yet
 * rendered) counts as matching nothing, so the count is a hint.
 */
export function read_styles(
	doc: Document = document,
	opts: { match?: boolean } = {}
): StylesReport {
	const res = new Map<string, PerformanceResourceTiming>();
	for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[])
		if (!tool_made(e)) res.set(e.name, e);
	const sheets: SheetRow[] = [];
	const examples: { sel: string; len: number }[] = [];
	let unreadable = 0;
	const blocks = paint_blocker();
	const panel = doc.querySelector(`[${OGYGIA_DEVTOOLS_HOST}]`)?.shadowRoot;
	for (const sheet of Array.from(doc.styleSheets)) {
		const node = sheet.ownerNode as Element | null;
		if (own_sheet(node)) continue;
		const href = sheet.href;
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			unreadable++;
			continue;
		}
		if (styles_the_panel(rules, doc, panel)) continue;
		const r = href ? res.get(href) : undefined;
		const dev_id = node?.getAttribute('data-vite-dev-id');
		let label = 'inline <style>';
		if (href) label = file_of(href);
		else if (dev_id) label = file_of(dev_id);
		const row: SheetRow = {
			label,
			href,
			rules: 0,
			bytes: href ? (r?.decodedBodySize ?? 0) : (node?.textContent?.length ?? 0),
			blocking: !!r && blocks(r),
			unmatched: opts.match ? 0 : null,
			unmatched_bytes: opts.match ? 0 : null,
			ogygia:
				!!node &&
				(node.hasAttribute(OGYGIA_REGION_CSS) ||
					node.hasAttribute(OGYGIA_RCSS) ||
					(href ?? '').includes('og-rcss'))
		};
		each_style_rule(rules, (rule) => {
			row.rules++;
			if (!opts.match) return;
			const text = (rule as CSSStyleRule).selectorText;
			if (text.includes('&')) return;
			let hit = false;
			for (const part of split_selectors(text)) {
				const m = matchable(part);
				if (!m) {
					hit = true;
					break;
				}
				try {
					if (doc.querySelector(m)) {
						hit = true;
						break;
					}
				} catch {
					hit = true;
					break;
				}
			}
			if (!hit) {
				row.unmatched!++;
				const len = rule.cssText.length;
				row.unmatched_bytes! += len;
				examples.push({ sel: text, len });
			}
		});
		sheets.push(row);
	}
	const sum = (k: 'rules' | 'bytes' | 'unmatched' | 'unmatched_bytes') =>
		sheets.reduce((s, x) => s + (x[k] ?? 0), 0);
	examples.sort((a, b) => b.len - a.len);
	return {
		sheets: sheets.sort((a, b) => b.bytes - a.bytes),
		rules: sum('rules'),
		bytes: sum('bytes'),
		unmatched: sum('unmatched'),
		unmatched_bytes: sum('unmatched_bytes'),
		examples: [...new Set(examples.map((e) => e.sel))].slice(0, 6),
		unscoped: [],
		unreadable
	};
}

/** The build's unscoped-fallback markers in the page's sheets: a component whose scoped CSS the
 *  build could not compile, whose rules then apply page-wide. The CSSOM drops comments, so the
 *  marker is read from the text: inline sheets their node's, linked ones one same-origin fetch
 *  each (the HTTP cache answers it). Devtools' own sheets are left out. */
export async function scan_unscoped(
	doc: Document = document
): Promise<(UnscopedStyles & { sheet: string })[]> {
	const out: (UnscopedStyles & { sheet: string })[] = [];
	const add = (css: string, sheet: string) => {
		for (const u of find_unscoped(css))
			if (!out.some((x) => x.file === u.file)) out.push({ ...u, sheet });
	};
	const jobs: Promise<void>[] = [];
	for (const sheet of Array.from(doc.styleSheets)) {
		const node = sheet.ownerNode as Element | null;
		if (own_sheet(node)) continue;
		if (!sheet.href) {
			if (node?.textContent) add(node.textContent, 'inline <style>');
			continue;
		}
		const href = sheet.href;
		if (new URL(href, location.href).origin !== location.origin) continue;
		jobs.push(
			// oxlint-disable-next-line ogygia/no-silent-failures -- a sheet that cannot be fetched is left out of the report
			tool_fetch(href, { cache: 'force-cache' })
				.then((r) => (r.ok ? r.text() : ''))
				.then((css) => add(css, file_of(href)))
				.catch(() => {})
		);
	}
	await Promise.all(jobs);
	return out;
}

/** What the styles report says: an unscoped component first, as a warning; rules that match
 *  nothing only once checked, and only when they are a real share (half the rules) of real bytes
 *  (20 KB of rule text). */
export function styles_findings(s: StylesReport): StylesFinding[] {
	const out: StylesFinding[] = [];
	if (s.unscoped.length) {
		const f = unscoped_finding(s.unscoped);
		out.push({ ...f, severity: 'warn' });
	}
	if (s.unmatched_bytes >= 20 * 1024 && s.rules && s.unmatched / s.rules >= 0.5) {
		const kb = Math.round(s.unmatched_bytes / 1024);
		const worst = s.sheets
			.filter((x) => (x.unmatched_bytes ?? 0) > 0)
			.sort((a, b) => (b.unmatched_bytes ?? 0) - (a.unmatched_bytes ?? 0))
			.slice(0, 3);
		out.push({
			code: 'css-unmatched',
			severity: 'info',
			message: `${Math.floor((s.unmatched / s.rules) * 100)}% of the page's CSS rules (${s.unmatched} of ${s.rules}, about ${kb} KB of rule text) match nothing on it right now. Most in: ${worst.map((w) => `${w.label} ${w.unmatched} rules`).join(', ')}.`,
			fix: "Styles in a component's own <style> load with that component. Move page-specific rules there, or split a big shared sheet by route. Menus, dialogs and content that appears later count as unmatched here: open them and check again."
		});
	}
	return out;
}
