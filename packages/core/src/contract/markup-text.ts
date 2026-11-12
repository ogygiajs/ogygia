import { OG_KEPT } from '../wire-markup.ts';

/** One attribute that differs between the server's markup and the island's after hydrate. */
export interface AttrChange {
	tag: string;
	name: string;
	from: string | null;
	to: string | null;
}

/** `name="value"` pairs of one start tag (`<a href="x" hidden>`), as the browser serializes them. */
function tag_attrs(tag: string): Map<string, string> {
	const out = new Map<string, string>();
	let i = 1;
	while (i < tag.length && tag[i] !== ' ' && tag[i] !== '>' && tag[i] !== '/') i++;
	while (i < tag.length) {
		while (
			i < tag.length &&
			(tag[i] === ' ' || tag[i] === '\n' || tag[i] === '\t' || tag[i] === '/')
		)
			i++;
		if (i >= tag.length || tag[i] === '>') break;
		const start = i;
		while (i < tag.length && tag[i] !== '=' && tag[i] !== ' ' && tag[i] !== '>') i++;
		const name = tag.slice(start, i);
		let value = '';
		if (tag[i] === '=') {
			i++;
			const q = tag[i];
			if (q === '"' || q === "'") {
				const end = tag.indexOf(q, i + 1);
				value = tag.slice(i + 1, end === -1 ? tag.length : end);
				i = end === -1 ? tag.length : end + 1;
			} else {
				const s = i;
				while (i < tag.length && tag[i] !== ' ' && tag[i] !== '>') i++;
				value = tag.slice(s, i);
			}
		}
		if (name) out.set(name, value);
	}
	return out;
}

/** The tag's name, lowercase (`<ds-button …>` → `ds-button`). */
function tag_name(tag: string): string {
	let i = 1;
	while (i < tag.length && tag[i] !== ' ' && tag[i] !== '>' && tag[i] !== '/' && tag[i] !== '\n')
		i++;
	return tag.slice(1, i).toLowerCase();
}

/**
 * When two markups (comments out) differ ONLY in attributes — the same elements in the same order, the
 * same text — each attribute that differs (at most 20); `null` when text or elements differ. A walk of
 * both strings tag by tag, no regex: it runs once per changed island.
 */
export function attr_changes(a: string, b: string): AttrChange[] | null {
	const out: AttrChange[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		const ti = a.indexOf('<', i);
		const tj = b.indexOf('<', j);
		if (a.slice(i, ti === -1 ? a.length : ti) !== b.slice(j, tj === -1 ? b.length : tj))
			return null;
		if (ti === -1 || tj === -1) return ti === tj ? out : null;
		const ei = a.indexOf('>', ti);
		const ej = b.indexOf('>', tj);
		const x = a.slice(ti, ei === -1 ? a.length : ei + 1);
		const y = b.slice(tj, ej === -1 ? b.length : ej + 1);
		i = ti + x.length;
		j = tj + y.length;
		if (x === y) continue;
		const tag = tag_name(x);
		if (tag !== tag_name(y) || x[1] === '/' || y[1] === '/') return null;
		const xa = tag_attrs(x);
		const ya = tag_attrs(y);
		for (const [name, v] of xa)
			if (ya.get(name) !== v && out.length < 20)
				out.push({ tag, name, from: v, to: ya.has(name) ? ya.get(name)! : null });
		for (const [name, v] of ya)
			if (!xa.has(name) && out.length < 20) out.push({ tag, name, from: null, to: v });
	}
	return out;
}

const RUNTIME_MARKS = [
	' data-nested=""',
	' data-hydrated=""',
	` ${OG_KEPT}=""`,
	' data-revalidated=""'
];

/** `html` without the attributes the runtime itself sets, empty, on the regions inside an island's markup. */
export function without_runtime_marks(html: string): string {
	for (const m of RUNTIME_MARKS) if (html.includes(m)) html = html.split(m).join('');
	return html;
}

/** `html` with every `<!-- … -->` removed; an unclosed comment runs to the end. */
export function without_comments(html: string): string {
	let at = html.indexOf('<!--');
	if (at === -1) return html;
	let out = '';
	let from = 0;
	while (at !== -1) {
		out += html.slice(from, at);
		const end = html.indexOf('-->', at + 4);
		if (end === -1) return out;
		from = end + 3;
		at = html.indexOf('<!--', from);
	}
	return `${out}${html.slice(from)}`;
}
