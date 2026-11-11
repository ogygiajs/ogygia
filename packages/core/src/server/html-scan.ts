/**
 * Small hand-written scans shared by the server's per-request HTML work, each kept only where it
 * MEASURED faster (or allocation-lighter) than the regex it replaced — the engine's compiled
 * matcher wins plain presence tests, so those stayed regexes (head-presence.ts).
 */
import { is_kit_boot_script } from '../runtime/kit-boot.ts';
import { tags, text_of } from '../wire-markup.ts';

/** `[A-Za-z0-9_]` — the regex `\w` (NaN, past the end, is not). */
export function is_word(c: number): boolean {
	return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95;
}

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

const REGION_CSS_ATTR = 'data-ogygia-region-css';

/**
 * Every region-CSS tag in `head`, in order, joined: the `<link … data-ogygia-region-css>` form AND the
 * inline `<style data-ogygia-region-css="href">…</style>` form a sheet under Kit's
 * `inlineStyleThreshold` takes. What an isolated render (a held region's body) must carry forward
 * from its head: keeping links only silently unstyled every small sheet.
 */
export function region_css_tags(head: string): string {
	let out = '';
	for (
		let attr = head.indexOf(REGION_CSS_ATTR);
		attr !== -1;
		attr = head.indexOf(REGION_CSS_ATTR, attr + 1)
	) {
		const open = head.lastIndexOf('<', attr);
		if (open === -1) continue;
		if (head.startsWith('<link', open) && !is_word(head.charCodeAt(open + 5))) {
			const end = head.indexOf('>', attr);
			if (end === -1) break;
			out += head.slice(open, end + 1);
			attr = end;
		} else if (head.startsWith('<style', open) && !is_word(head.charCodeAt(open + 6))) {
			const close = head.indexOf('</style>', attr);
			if (close === -1) break;
			out += head.slice(open, close + 8);
			attr = close + 7;
		}
	}
	return out;
}

/** Every `<link …data-ogygia-region-css…>` tag in `head`, in order, joined — what
 *  `head.match(/<link\b[^>]*data-ogygia-region-css[^>]*>/g).join('')` returned. */
export function region_css_links(head: string): string {
	let out = '';
	// (the next attribute occurrence is found once and reused until the walk passes it: linear)
	let attr = head.indexOf('data-ogygia-region-css');
	if (attr === -1) return '';
	for (let at = head.indexOf('<link'); at !== -1; at = head.indexOf('<link', at + 5)) {
		if (is_word(head.charCodeAt(at + 5))) continue;
		const end = head.indexOf('>', at);
		if (end === -1) break;
		if (attr < at) attr = head.indexOf('data-ogygia-region-css', at);
		if (attr === -1) break;
		if (attr < end) out += head.slice(at, end + 1);
		at = end - 4; // (resume after the tag)
	}
	return out;
}
