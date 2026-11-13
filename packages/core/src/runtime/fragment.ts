/**
 * The element a URL fragment points at, read as the browser reads it (HTML "find a potential
 * indicated element"): the fragment as written first, then its percent-decoding. The decoding never
 * throws: a bad escape (`#%E0`) stays as written and a byte that is not UTF-8 becomes U+FFFD, so a
 * link with any hash is still a link (test/browser/nav-bad-hash-escape.test.ts). `#top` and an empty
 * fragment point at the top of the page, which is no element: the caller handles them.
 */

/** Is the fragment one that means "the top of the page"? */
export function fragment_is_top(hash: string): boolean {
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	return !raw || decode_fragment(raw).toLowerCase() === 'top';
}

/** The element `hash` (with or without its `#`) points at in `doc`, or null. */
export function fragment_target(hash: string, doc: Document = document): Element | null {
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	if (!raw) return null;
	const found = potential_target(raw, doc);
	if (found) return found;
	const decoded = decode_fragment(raw);
	return decoded === raw ? null : potential_target(decoded, doc);
}

function potential_target(name: string, doc: Document): Element | null {
	return doc.getElementById(name) ?? doc.querySelector(`a[name="${CSS.escape(name)}"]`);
}

/** Percent-decode to bytes, then UTF-8 with replacement: what the browser does, where
 *  `decodeURIComponent` throws. */
function decode_fragment(raw: string): string {
	if (!raw.includes('%')) return raw;
	const bytes = new TextEncoder().encode(raw);
	const out: number[] = [];
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i]!;
		if (b === 0x25 && i + 2 < bytes.length) {
			const hex = String.fromCharCode(bytes[i + 1]!, bytes[i + 2]!);
			if (/^[0-9a-f]{2}$/i.test(hex)) {
				out.push(parseInt(hex, 16));
				i += 2;
				continue;
			}
		}
		out.push(b);
	}
	return new TextDecoder().decode(Uint8Array.from(out));
}
