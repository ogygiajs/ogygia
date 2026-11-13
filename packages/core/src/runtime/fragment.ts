/** Is the fragment one that means "the top of the page"? */
export function fragment_is_top(hash: string): boolean {
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	return !raw || decode_fragment(raw).toLowerCase() === 'top';
}

// @why HTML's "find a potential indicated element" tries the fragment as written, then its percent-decoding (test: test/browser/fragment.test.ts › the fragment as written wins over its decoding)
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

// @why the browser percent-decodes to bytes, then UTF-8 with replacement, where `decodeURIComponent` throws (test: test/browser/fragment.test.ts › a bad escape never throws: it is read as written, or with U+FFFD)
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
