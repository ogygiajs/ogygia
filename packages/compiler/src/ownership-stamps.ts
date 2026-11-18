import { parse } from 'svelte/compiler';
import { splice_text, type Edit } from './splice.ts';
import { blank_styles } from './blank-styles.ts';
import { strip_bom } from './bom.ts';
import { HTML_RANGE_MARK, OG_HTML, OG_OPAQUE } from '@ogygia/core/contract';
import type { AstNode } from './parse/oxc.ts';

const MAY_STAMP_RE =
	// oxlint-disable-next-line ogygia/one-markup-walk -- a prefilter before Svelte's own parse; a false yes only costs that parse
	/\{@html|bind:(?:innerHTML|textContent|innerText)|<[a-z][\w.]*-[\w-]*[\s/>]|\sis=/;
const WHOLESALE_BINDS: ReadonlySet<string> = new Set(['innerHTML', 'textContent', 'innerText']);

type Node = AstNode & { type: string; start: number; end: number };

const is_blank = (n: Node) => n.type === 'Text' && !String(n.data ?? '').trim();

function literal_attributes(el: Node): boolean {
	for (const a of el.attributes ?? []) {
		if (a.type !== 'Attribute') return false;
		const v = a.value;
		if (v === true) continue;
		const parts = Array.isArray(v) ? v : [v];
		if (parts.some((p: Node) => p.type !== 'Text')) return false;
	}
	return true;
}

function all_static(nodes: Node[]): boolean {
	for (const n of nodes) {
		if (n.type === 'Text' || n.type === 'Comment') continue;
		if (n.type !== 'RegularElement') return false;
		if (!literal_attributes(n)) return false;
		if (!all_static(n.fragment?.nodes ?? [])) return false;
	}
	return true;
}

function is_custom_element(el: Node): boolean {
	return (
		String(el.name).includes('-') ||
		(el.attributes ?? []).some((a: Node) => a.type === 'Attribute' && a.name === 'is')
	);
}

function opaque(el: Node): boolean {
	if (has_attribute(el, OG_OPAQUE)) return false;
	const kids: Node[] = (el.fragment?.nodes ?? []).filter((n: Node) => !is_blank(n));
	if (kids.length === 1 && kids[0].type === 'HtmlTag') return true;
	if (
		(el.attributes ?? []).some(
			(a: Node) => a.type === 'BindDirective' && WHOLESALE_BINDS.has(a.name)
		)
	)
		return true;
	return is_custom_element(el) && all_static(el.fragment?.nodes ?? []);
}

function has_attribute(el: Node, name: string): boolean {
	return (el.attributes ?? []).some((a: Node) => a.type === 'Attribute' && a.name === name);
}

const insert = (pos: number, text: string): Edit => ({ start: pos, end: pos, text });

const RANGE_OPEN = `((s) => s && '<!--${HTML_RANGE_MARK}-->' + s)(String((`;
const RANGE_CLOSE = `) ?? ''))`;

const CHILD_KEYS = [
	'fragment',
	'consequent',
	'alternate',
	'body',
	'pending',
	'then',
	'catch',
	'fallback'
];

/**
 * `source` with every opaque element stamped, and every element holding an `{@html}` beside other
 * children stamped `data-og-html` with each `{@html}` range marked; or `null` when there is nothing to
 * stamp (or the file does not parse — the real compile reports that). Outermost wins: nothing is
 * stamped inside a stamped element (the repair never enters it anyway).
 */
export function stamp_opaque(raw: string, filename: string): string | null {
	const source = strip_bom(raw);
	const edits = opaque_stamp_edits(source, filename);
	return edits.length ? splice_text(source, edits) : null;
}

/** The inserts `stamp_opaque` makes to `source` (no byte-order mark): none when there is nothing to
 *  stamp. Server leg only: the client never sees a stamp or a mark. */
export function opaque_stamp_edits(source: string, filename: string): Edit[] {
	if (!MAY_STAMP_RE.test(source)) return [];
	let ast: Node;
	try {
		ast = parse(blank_styles(source), { modern: true, filename }) as unknown as Node;
		// oxlint-disable-next-line ogygia/no-silent-failures -- no stamps is the safe answer (under); Svelte's own compile reports the syntax
	} catch {
		return [];
	}
	const edits: Edit[] = [];
	const visit = (nodes: Node[] | undefined) => {
		for (const n of nodes ?? []) {
			if (n.type === 'RegularElement' && opaque(n)) {
				edits.push(insert(n.start + 1 + String(n.name).length, ` ${OG_OPAQUE}`));
				continue;
			}
			if (n.type === 'RegularElement' && !has_attribute(n, OG_OPAQUE)) {
				const html_tags = (n.fragment?.nodes ?? []).filter((c: Node) => c.type === 'HtmlTag');
				if (html_tags.length) {
					if (!has_attribute(n, OG_HTML))
						edits.push(insert(n.start + 1 + String(n.name).length, ` ${OG_HTML}`));
					for (const h of html_tags) {
						edits.push(insert(h.expression.start, RANGE_OPEN));
						edits.push(insert(h.expression.end, RANGE_CLOSE));
					}
				}
			}
			for (const k of CHILD_KEYS) {
				const child = n[k];
				if (child && Array.isArray(child.nodes)) visit(child.nodes);
			}
		}
	};
	visit(ast.fragment?.nodes);
	return edits;
}
