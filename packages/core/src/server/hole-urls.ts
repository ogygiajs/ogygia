/**
 * Absolute URLs inside a hole's HTML.
 *
 * A server island renders in its OWN request — `/__ogygia__?…` — and Kit's `asset()` (with the
 * default `paths.relative`) emits every URL relative to THAT request: `./_app/immutable/x.js`,
 * `./__ogygia__?…`. The HTML then lands in a page at any depth (`/docs/guides/`), and a
 * region entry / nested-hole endpoint / region-css link inside it would resolve against the page:
 * `/docs/guides/_app/…` → 404, a dead island in a live hole. The batch parcel and an
 * ESI-stitched hole (the CDN splices the bytes straight into the page) have the same problem, so
 * the fix is on the server, once, at the point the response is assembled: resolve every relative
 * ogygia URL against the endpoint request URL and emit it root-absolute (Kit `base` included).
 * Absolute (`/…`) and scheme'd (foreign federation entries) values are left alone.
 */
import { escape_amp } from '../escape.ts';
import { Needle, next_tag, OGYGIA_REGION_CSS, value_at, type FoundTag } from '../wire-markup.ts';
import { REGION_CSS_ANY_CASE } from './html-scan.ts';

// The attribute sites ogygia writes URLs into hole HTML: an `<ogygia-region>`'s `entry` / `src` /
// `endpoint`, a region-css `<link>`'s `href`, an inlined region sheet's `data-ogygia-region-css`
// identity. Values are attribute-escaped (`&` → `&amp;`), so the resolver un-escapes, resolves, and
// re-escapes. Tags are read through the browser-faithful reader (wire-markup.ts), each value
// rewritten only when it is relative.
// (`src` too: an island's location, written beside its identity since locations — left relative,
// an island inside a hole imported `/<page>/_app/…` and woke on a redirect to an HTML page)
const REGION_URL_ATTRS = ['entry', 'src', 'endpoint'] as const;

function resolve_attr(value: string, base: URL): string {
	if (!value || !(value.startsWith('./') || value.startsWith('../'))) return value;
	let resolved: URL;
	try {
		resolved = new URL(
			value.indexOf('&amp;') === -1 ? value : value.replaceAll('&amp;', '&'),
			base
		);
	} catch {
		return value;
	}
	if (resolved.origin !== base.origin) return value;
	return escape_amp(resolved.pathname + resolved.search + resolved.hash);
}

/** One value rewrite: `html[at, end)` becomes `text`. */
interface Splice {
	at: number;
	end: number;
	text: string;
}

/** Queue the rewrite of `tag`'s `attr` value when it is relative. */
function splice_value(
	html: string,
	tag: FoundTag,
	name: string,
	attr: string,
	base: URL,
	out: Splice[]
): void {
	const value = tag.attr(attr);
	if (value === undefined) return;
	const next = resolve_attr(value, base);
	if (next === value) return;
	const at = value_at(html, tag, name, attr);
	if (at !== -1) out.push({ at, end: at + value.length, text: next });
}

/** Rewrite the relative `entry` / `src` / `endpoint` / region-css `href` values in `html` to root-absolute
 *  paths resolved against `base` (the endpoint request URL). */
export function absolutize_hole_html(html: string, base: URL): string {
	const splices: Splice[] = [];
	// (a relative value holds `./`: a region tag whose span has none is passed without a read)
	const dot = new Needle(html, './');
	if (dot.gone) return html;
	for (
		let t = next_tag(html, 'ogygia-region', 0);
		t !== null;
		t = next_tag(html, 'ogygia-region', t.next)
	) {
		const held = dot.holds(t);
		if (dot.gone) break;
		if (!held) continue;
		for (const attr of REGION_URL_ATTRS)
			splice_value(html, t, 'ogygia-region', attr, base, splices);
	}
	// region CSS: only a tag whose span holds the attribute's name gets an attribute read
	for (const name of ['link', 'style'] as const) {
		const mark = new Needle(html, REGION_CSS_ANY_CASE);
		if (mark.gone) break;
		for (let t = next_tag(html, name, 0); t !== null; t = next_tag(html, name, t.next)) {
			const held = mark.holds(t);
			if (mark.gone) break;
			if (!held || t.attr(OGYGIA_REGION_CSS) === undefined) continue;
			splice_value(html, t, name, name === 'link' ? 'href' : OGYGIA_REGION_CSS, base, splices);
		}
	}
	if (splices.length === 0) return html;
	splices.sort((a, b) => a.at - b.at);
	let out = '';
	let pos = 0;
	for (const s of splices) {
		out += html.slice(pos, s.at) + s.text;
		pos = s.end;
	}
	return out + html.slice(pos);
}
