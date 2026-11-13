import { MarkupCursor, markup_tokens, read_tag, tag_name } from '../markup-walk.ts';
import { OG_KEPT } from '../wire-markup.ts';

/** One attribute that differs between the server's markup and the island's after hydrate. */
export interface AttrChange {
	tag: string;
	name: string;
	from: string | null;
	to: string | null;
}

/** The pieces of `html` as core's tag walk cuts them: kind, start, end, where a tag's name ends. */
function pieces_of(html: string): number[] {
	const out: number[] = [];
	markup_tokens(html, (kind, start, end, ne) => {
		out.push(kind, start, end, ne);
	});
	return out;
}

/**
 * When two markups (comments out) differ ONLY in attributes — the same elements in the same order, the
 * same text — each attribute that differs (at most 20); `null` when text or elements differ. Both are
 * read by core's tag walk, as the browser reads them (a `>` in a quoted value, any quoting, the first
 * of two same-name attributes): it runs once per changed island. The page beacon's own copy
 * (devtools beacon-standalone.ts) answers the same (profiler-page-beacon-parity.test.ts).
 */
export function attr_changes(a: string, b: string): AttrChange[] | null {
	const pa = pieces_of(a);
	const pb = pieces_of(b);
	if (pa.length !== pb.length) return null;
	const out: AttrChange[] = [];
	for (let k = 0; k < pa.length; k += 4) {
		const kind = pa[k];
		if (kind !== pb[k]) return null;
		const x = a.slice(pa[k + 1], pa[k + 2]);
		const y = b.slice(pb[k + 1], pb[k + 2]);
		if (x === y) continue;
		// (text, an end tag or a comment that differs: not attributes only)
		if (kind !== 1) return null;
		const tx = read_tag(a, pa[k + 1], pa[k + 3])!;
		const ty = read_tag(b, pb[k + 1], pb[k + 3])!;
		const tag = tag_name(a, tx);
		if (tag !== tag_name(b, ty)) return null;
		const xa = tx.attrs;
		const ya = ty.attrs;
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

/** `html` with every `<!--` comment removed, as core's tag walk reads one (it ends at `-->` or
 *  `--!>`, or at once for `<!-->`; a `<!--` in a script's text or a quoted value is none); an
 *  unclosed comment runs to the end. */
export function without_comments(html: string): string {
	if (!html.includes('<!--')) return html;
	let out = '';
	const at = new MarkupCursor(html);
	while (at.next()) {
		if (at.kind === 3 && html.startsWith('<!--', at.start)) continue;
		if (at.kind === 0 && !at.raw) {
			// (the walk reads any `<!--` it reaches as a comment: one left in text is one the markup
			// ends inside, which runs to the end)
			// markup-ok: the walk's own tail, cut where its unclosed comment opens
			const open = html.indexOf('<!--', at.start);
			if (open !== -1 && open < at.end) return out + html.slice(at.start, open);
		}
		out += html.slice(at.start, at.end);
	}
	return out;
}
