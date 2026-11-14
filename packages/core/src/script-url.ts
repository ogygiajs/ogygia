/**
 * Whether a browser would run `value` as script when it follows or loads it as a URL: its scheme,
 * read as the WHATWG URL parser reads it, is `javascript:`, `vbscript:` or `data:`. The parser
 * trims leading C0 controls and spaces, and drops ASCII tab, LF and CR anywhere; a scheme is an
 * ASCII letter, then letters, digits, `+`, `-` or `.`, then `:`. A value with no scheme is a
 * relative URL. `value` is the attribute's value as the DOM holds it (character references decoded).
 *
 * Self-contained (no outer names): the inline restorer ships it as its own source.
 */
export function is_script_url(value: string): boolean {
	const n = value.length;
	let i = 0;
	while (i < n && value.charCodeAt(i) <= 0x20) i++;
	let scheme = '';
	for (; i < n; i++) {
		const c = value.charCodeAt(i);
		if (c === 0x09 || c === 0x0a || c === 0x0d) continue;
		if (c === 0x3a) return scheme === 'javascript' || scheme === 'vbscript' || scheme === 'data';
		const lower = c | 0x20;
		if (lower < 0x61 || lower > 0x7a || scheme.length === 10) return false;
		scheme += String.fromCharCode(lower);
	}
	return false;
}
