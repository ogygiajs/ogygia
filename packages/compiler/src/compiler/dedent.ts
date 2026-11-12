// ── regexes
const CRLF_G = /\r\n?/g;
const LEADING_INDENT_RE = /^[\t ]*/;

/**
 * Strip the common leading indentation from a block of source, and trim leading/trailing blank
 * lines. Source embedded in a call (`import.meta.og.code(\`…\`, …)`) is indented to match where the
 * call sits; that indentation is an artifact of the surrounding code, not part of the snippet. This
 * normalizes it so the rendered `<pre>` shows the snippet's OWN logical indentation, flush-left.
 *
 * Blank lines (whitespace-only) don't count toward the common indent; tabs and spaces are treated by
 * their literal column contribution to the prefix (the common prefix is computed on raw characters,
 * so mixed tabs/spaces still de-indent correctly as long as the leading run is consistent — which it
 * is for machine-indented source).
 *
 * Also a TAG, for the code the compiler generates (its virtual modules), written as the code itself:
 *
 *     dedent`
 *         export const dev = ${is_dev};
 *     `
 *
 * The template's own text is de-indented first and the values go in after, so a value spanning lines
 * (a generated block) never decides the indent. Values are interpolated as a template literal would
 * (cooked strings: `\\n` in the template is a newline).
 */
export function dedent(text: string): string;
export function dedent(strings: TemplateStringsArray, ...values: unknown[]): string;
export function dedent(first: string | TemplateStringsArray, ...values: unknown[]): string {
	if (typeof first === 'string') return dedent_text(first);
	// a placeholder per value (a character no template text holds), de-indented as plain text
	let text = first[0];
	for (let i = 1; i < first.length; i++) text += SLOT + (i - 1) + SLOT + first[i];
	const flat = dedent_text(text);
	if (values.length === 0) return flat;
	let out = '';
	let at = 0;
	for (;;) {
		const open = flat.indexOf(SLOT, at);
		if (open === -1) return out + flat.slice(at);
		const close = flat.indexOf(SLOT, open + 1);
		out += flat.slice(at, open) + String(values[Number(flat.slice(open + 1, close))]);
		at = close + 1;
	}
}

/** The placeholder edge for a tag's value while its template is de-indented. */
const SLOT = '\u0000';

function dedent_text(text: string): string {
	// Normalize CRLF so line handling is uniform; the renderer emits LF anyway.
	const lines = text.replace(CRLF_G, '\n').split('\n');

	// Drop leading and trailing blank lines (the newline right after the opening backtick, etc.).
	while (lines.length && lines[0]!.trim() === '') lines.shift();
	while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
	if (!lines.length) return '';

	// Common leading-whitespace prefix across NON-blank lines.
	let common: string | null = null;
	for (const line of lines) {
		if (line.trim() === '') continue; // blank lines don't constrain the indent
		const lead = LEADING_INDENT_RE.exec(line)![0];
		if (common === null) {
			common = lead;
		} else {
			// Shrink `common` to the longest shared prefix of the two leads.
			let i = 0;
			const max = Math.min(common.length, lead.length);
			while (i < max && common[i] === lead[i]) i++;
			common = common.slice(0, i);
		}
		if (common === '') break; // nothing shared — nothing to strip
	}

	const n = common?.length ?? 0;
	return lines.map((line) => (line.trim() === '' ? '' : line.slice(n))).join('\n');
}
