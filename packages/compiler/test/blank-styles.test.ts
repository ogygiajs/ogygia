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

	it('a <style> inside an HTML comment is text, left alone', () => {
		const src = '<!-- <style>.x { color: red }</style> --><p></p>';
		expect(blank_styles(src)).toBe(src);
	});

	it('a component whose SCSS the Svelte parser rejects parses once blanked, offsets intact', async () => {
		const { parse } = await import('svelte/compiler');
		const src = '<p class="a">x</p>\n<style lang="scss">@each $i in 1, 2 { .a-#{$i} {} }</style>';
		expect(() => parse(src, { modern: true })).toThrow();
		const ast = parse(blank_styles(src), { modern: true });
		expect(src.slice(ast.css!.start, ast.css!.end)).toBe(
			src.slice(src.indexOf('<style'), src.length)
		);
	});
});
