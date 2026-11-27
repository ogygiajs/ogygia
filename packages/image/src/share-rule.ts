/**
 * A dev rule: a page's share image (`og:image`, `twitter:image`) names a PNG or JPEG file, the
 * formats link previews show. One naming an AVIF or WebP file says `image_share_format`.
 *
 * @packageDocumentation
 */
import { next_any_tag, tag_name } from '@ogygia/core/contract';

const SHARE_KEYS: ReadonlySet<string> = new Set([
	'og:image',
	'og:image:url',
	'og:image:secure_url',
	'twitter:image',
	'twitter:image:src'
]);
const UNSHOWN_RE = /\.(?:avif|webp)$/i;

/** The share image URLs in `html` that name an AVIF or WebP file. */
export function unshown_share_images(html: string): string[] {
	const out: string[] = [];
	for (let t = next_any_tag(html, 0); t !== null; t = next_any_tag(html, t.next)) {
		if (tag_name(html, t) !== 'meta') continue;
		const key = (t.attr('property') ?? t.attr('name'))?.toLowerCase();
		if (key === undefined || !SHARE_KEYS.has(key)) continue;
		const url = (t.attr('content') ?? '').replaceAll('&amp;', '&');
		if (UNSHOWN_RE.test(url.split(/[?#]/, 1)[0]!)) out.push(url);
	}
	return out;
}
