import { describe, expect, it } from 'vitest';
import { blank_styles } from '../src/compiler/blank-styles.ts';

describe('blank_styles', () => {
	it('blanks only style content, keeps newlines, leaves a <style> string inside a script untouched', () => {
		const src = `<script>const s = '<style>x{}</style>';</script>\n<STYLE lang="scss">\n.a-#{$i} {}\n</STYLE>\n<styles-not>keep</styles-not>`;
		const out = blank_styles(src);
		expect(out.length).toBe(src.length);
		expect(out).toContain(`const s = '<style>x{}</style>';`);
		expect(out).toContain(
			'<STYLE lang="scss">\n' + ' '.repeat('.a-#{$i} {}'.length) + '\n</STYLE>'
		);
		expect(out).toContain('<styles-not>keep</styles-not>');
	});
});
