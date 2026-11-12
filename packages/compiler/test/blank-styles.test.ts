import { describe, expect, it } from 'vitest';
import { blank_styles } from '../src/blank-styles.ts';
import { dedent } from '@ogygia/core/plugin/utils';

describe('blank_styles', () => {
	it('blanks only style content, keeps newlines, leaves a <style> string inside a script untouched', () => {
		const src = dedent`
			<script>const s = '<style>x{}</style>';</script>
			<STYLE lang="scss">
			.a-#{$i} {}
			</STYLE>
			<styles-not>keep</styles-not>
		`;
		const out = blank_styles(src);
		expect(out.length).toBe(src.length);
		expect(out).toContain(`const s = '<style>x{}</style>';`);
		expect(out).toContain(
			dedent`
				<STYLE lang="scss">
				${' '.repeat('.a-#{$i} {}'.length)}
				</STYLE>
			`
		);
		expect(out).toContain('<styles-not>keep</styles-not>');
	});
});
