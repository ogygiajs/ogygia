/**
 * Small scans shared by the server's per-request HTML work. Tags are read through the browser-faithful
 * reader (wire-markup.ts `tags()`); the character tests below serve hand-written scans elsewhere.
 */
import { is_kit_boot_script } from '../runtime/kit-boot.ts';
import { Needle, next_tag, OGYGIA_REGION_CSS, text_of } from '../wire-markup.ts';

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

// @why Kit appends its boot script, the page's data inside it, at the end of the body (test: test/kit-gate.test.ts › finds Kit script whole however much data it carries (a large page, 200 KB of it))
const KIT_BOOT_WINDOW = 65_536;

/**
 * Whether a page's HTML carries Kit's boot (a csr=true page): the DOM probe's question
 * (runtime/kit-boot.ts `is_kit_boot_script`) over a string (pass the index of `</body>` as `end`).
 * A 2.6 MB document is never scanned whole: see {@link kit_boot_script}.
 */
export function html_has_kit_bootstrap(html: string, end: number = html.length): boolean {
	return kit_boot_script(html, end) !== null;
}

/**
 * Kit's boot script: its text and where that text starts in `html`, or `null` when the page has none.
 * The scripts are read from the last one before `end` backwards, each from its own `<script`, and
 * only those that end in the last 64 KB: however much data Kit's script carries, it is found whole.
 */
export function kit_boot_script(
	html: string,
	end: number = html.length
): { text: string; at: number } | null {
	const floor = end - KIT_BOOT_WINDOW;
	const before = (from: number) =>
		// oxlint-disable-next-line ogygia/one-markup-walk -- the walk reads forward only and Kit's script can start megabytes back: each candidate is read by the walk from its own `<`
		from < 0 ? -1 : html.lastIndexOf('<script', from);
	for (let at = before(end - 1); at !== -1;) {
		const t = next_tag(html, 'script', at);
		const text = t !== null && t.start === at ? text_of(html, t, 'script') : null;
		if (t !== null && text !== null) {
			const close = t.end + text.length;
			if (close < floor) return null;
			if (
				close <= end &&
				!t.attrs.has('src') &&
				is_kit_boot_script(t.attrs.get('type') ?? '', (a) => t.attrs.has(a), text)
			)
				return { text, at: t.end };
		}
		at = before(at - 1);
	}
	return null;
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
