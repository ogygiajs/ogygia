/**
 * A component's source with every `<style>` block's CONTENT blanked: each character a space,
 * newlines kept, so every offset is the source's own (edits made from the parse land on the
 * original, and a `source.slice(ast.css.start, ast.css.end)` still reads the real style).
 *
 * For the passes that parse a RAW component (before any preprocessor) and never read its styles:
 * Svelte's parser reads `<style>` as plain CSS, and a valid `<style lang="scss">` with SCSS-only
 * syntax (`#{$i}`, `@each`, `@for`) throws `css_expected_identifier`. Those passes then skipped the
 * file in silence: the barrel rewrite left its imports on their barrels (the island shipped the
 * whole barrel), the island transform left its region imports untransformed.
 *
 * The blocks are the component's own (parse/scan.ts `component_blocks`): a `<style>` inside a
 * `<script>` (a template string) or a comment is text and is left alone.
 */
import { component_blocks } from './parse/scan.ts';

const MAY_STYLE = /<style/i;

export function blank_styles(code: string): string {
	if (!MAY_STYLE.test(code)) return code;
	let out = '';
	let at = 0;
	for (const b of component_blocks(code)) {
		if (b.kind !== 'style') continue;
		out += code.slice(at, b.start);
		let run = 0;
		for (let k = b.start; k < b.end; k++) {
			const c = code[k];
			if (c === '\n' || c === '\r') {
				out += ' '.repeat(run) + c;
				run = 0;
			} else run++;
		}
		out += ' '.repeat(run);
		at = b.end;
	}
	return at === 0 ? code : out + code.slice(at);
}
