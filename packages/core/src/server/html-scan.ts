/**
 * Small scans shared by the server's per-request HTML work. Tags are read through the browser-faithful
 * reader (wire-markup.ts `tags()`); the character tests below serve hand-written scans elsewhere.
 */
import { is_kit_boot_script } from '../runtime/kit-boot.ts';
import { Needle, next_tag, OGYGIA_REGION_CSS, tags, text_of } from '../wire-markup.ts';

/** The regex `\s`: ASCII whitespace and the Unicode spaces (NaN, past the end, is not). */
export function is_space(c: number): boolean {
	if (c <= 32) return c === 32 || (c >= 9 && c <= 13);
	if (c < 160) return false;
	return (
		c === 160 ||
		c === 0x1680 ||
		(c >= 0x2000 && c <= 0x200a) ||
		c === 0x2028 ||
		c === 0x2029 ||
		c === 0x202f ||
		c === 0x205f ||
		c === 0x3000 ||
		c === 0xfeff
	);
}

/** How far before `end` the Kit-boot check looks. Kit appends its boot script at the END of the
 *  body (render.js), right before `</body>`, so this window holds it whenever it exists. */
const KIT_BOOT_WINDOW = 65_536;

/**
 * Whether a page's HTML carries Kit's boot (a csr=true page): the DOM probe's question
 * (runtime/kit-boot.ts `is_kit_boot_script`) over a string, bounded to the last 64 KB before `end`
 * (pass the index of `</body>`). A 2.6 MB document is never scanned whole: Kit's boot sits at the end
 * of the body, so the window is exact, not a heuristic.
 */
export function html_has_kit_bootstrap(html: string, end: number = html.length): boolean {
	const window = html.slice(Math.max(0, end - KIT_BOOT_WINDOW), end);
	for (const t of tags(window, 'script')) {
		if (t.attrs.has('src')) continue;
		const text = text_of(window, t, 'script');
		if (text !== null && is_kit_boot_script(t.attrs.get('type') ?? '', (a) => t.attrs.has(a), text))
			return true;
	}
	return false;
}

/** The region-CSS name's text in any case: the needle a tag's span must hold (wire-markup.ts `Needle`). */
export const REGION_CSS_ANY_CASE: RegExp = new RegExp(OGYGIA_REGION_CSS, 'gi');

/**
 * Every region-CSS tag in `head`, in order, joined: the `<link … data-ogygia-region-css>` form AND the
 * inline `<style data-ogygia-region-css="href">…</style>` form a sheet under Kit's
 * `inlineStyleThreshold` takes. What an isolated render (a held region's body) must carry forward
 * from its head: keeping links only silently unstyled every small sheet.
 */
export function region_css_tags(head: string): string {
	// (a tag the name's text is not inside cannot carry it: most skip the attribute read)
	const mark = new Needle(head, REGION_CSS_ANY_CASE);
	if (mark.gone) return '';
	let out = '';
	let link = next_tag(head, 'link', 0);
	let style = next_tag(head, 'style', 0);
	while (link !== null || style !== null) {
		const tag = link !== null && (style === null || link.start < style.start) ? link : style!;
		const held = mark.holds(tag);
		if (mark.gone) return out;
		if (tag === link) {
			if (held && link.attr(OGYGIA_REGION_CSS) !== undefined)
				out += head.slice(link.start, link.end);
			link = next_tag(head, 'link', link.next);
			continue;
		}
		// a style's text is raw: a `<link>` written inside it is not a tag
		const text = text_of(head, tag, 'style');
		if (text === null) break;
		const gt = head.indexOf('>', tag.end + text.length);
		if (gt === -1) break;
		const end = gt + 1;
		if (held && tag.attr(OGYGIA_REGION_CSS) !== undefined) out += head.slice(tag.start, end);
		if (link !== null && link.start < end) link = next_tag(head, 'link', end);
		style = next_tag(head, 'style', end);
	}
	return out;
}
