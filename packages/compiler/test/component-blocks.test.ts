// A COMPONENT'S SCRIPT AND STYLE BLOCKS ARE READ AS MARKUP (#1370). Every compiler pass that splits a
// `.svelte` source into its blocks reads the opening tag the way Svelte's markup is read: a value may
// hold `>` or the other quote, an attribute may be unquoted or in any case, a comment holds no block,
// a block's text holds no tag, and `<scripts>` is not `<script>`.
import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { og_js_regions } from '../src/parse/scan.ts';
import { svelteModuleHasTransportable } from '../src/transportables.ts';
import { blank_styles } from '../src/blank-styles.ts';
import { preprocess_component_for_css } from '../src/vite/style-preprocess.ts';
import { dedent } from '@ogygia/core/contract';

const MARKUP = ['.svelte'];
const regions = (src: string) =>
	og_js_regions(src, '/app/src/lib/A.svelte', MARKUP)!.map((r) => r.code.trim());

describe('the script regions of a component', () => {
	test('a value holding `>` does not end the opening tag', () => {
		expect(regions(`<script data-note="a>b" lang="ts">let a = 1;</script>`)).toEqual([
			'let a = 1;'
		]);
	});

	test('a script inside a comment is not a block', () => {
		expect(regions(`<!-- <script>let old = 1;</script> -->\n<script>let a = 1;</script>`)).toEqual([
			'let a = 1;'
		]);
	});

	test('a tag that only starts with `script` is not one', () => {
		expect(regions(`<scripts>not code</scripts>\n<script>let a = 1;</script>`)).toEqual([
			'let a = 1;'
		]);
	});

	test('a style whose text names a script holds no script', () => {
		expect(
			regions(
				`<style>/* <script>x</script> */ p { color: red }</style>\n<script>let a = 1;</script>`
			)
		).toEqual(['let a = 1;']);
	});
});

describe('the module script of a component', () => {
	const wired = (open: string) => dedent`
		${open}
			export class Money {
				static wire = import.meta.og.wire({ encode: (m) => m, decode: (v) => v });
			}
		</script>
	`;

	test('an unquoted context=module is the module script', () => {
		expect(svelteModuleHasTransportable(wired('<script context=module>'), '/a/A.svelte')).toBe(
			true
		);
	});

	test('a value that says module is not', () => {
		expect(svelteModuleHasTransportable(wired('<script data-kind="module">'), '/a/A.svelte')).toBe(
			false
		);
	});
});

describe('blanking styles keeps every tag whole', () => {
	test('a style whose attribute holds `>`', () => {
		const src = `<style data-note="a>b">p { color: red }</style>`;
		const out = blank_styles(src);
		expect(out.length).toBe(src.length);
		expect(out.startsWith(`<style data-note="a>b">`)).toBe(true);
		expect(out.endsWith(`</style>`)).toBe(true);
		expect(out.slice(`<style data-note="a>b">`.length, -`</style>`.length).trim()).toBe('');
	});
});

describe('the CSS preprocess keeps the script it strips', () => {
	test('`$$` in a TS script is written back as written', async () => {
		const src = dedent`
			<script lang="ts">
				const all: unknown = $$props;
			</script>
			<p class="a">x</p>
			<style>.a { color: red }</style>
		`;
		const out = await preprocess_component_for_css(src, '/app/src/lib/A.svelte', '/app');
		expect(out).toContain('$$props');
	});

	test('a scss style comes out as CSS with its lang dropped', async () => {
		const root = fileURLToPath(new URL('../', import.meta.url));
		const src = dedent`
			<p class="a">x</p>
			<style lang="scss" data-note="a>b">$c: red; .a { color: $c }</style>
		`;
		const out = await preprocess_component_for_css(src, `${root}src/lib/A.svelte`, root);
		expect(out).toContain('<style data-note="a>b">');
		expect(out).not.toContain('lang=');
		expect(out).not.toContain('$c');
	});
});

describe('which files hold JS regions', () => {
	test('a JS or TS module is one region from its start, a query after its name included', () => {
		const src = `export const a = 1;`;
		for (const id of ['/a/b.ts', '/a/b.js?raw', '/a/b.svelte.ts', '/a/b.mts?v=1'])
			expect(og_js_regions(src, id, MARKUP)).toEqual([{ code: src, offset: 0 }]);
	});

	test('a content file is not a host: the markdown preprocessor owns it', () => {
		for (const id of ['/a/b.md', '/a/b.svx', '/a/b.css'])
			expect(og_js_regions(`<script>let a = 1;</script>`, id, MARKUP)).toBeNull();
	});
});

describe('a block is closed by its end tag', () => {
	test('a script whose end tag never comes is no block', () => {
		expect(og_js_regions(`<p>x</p>\n<script>let a = 1;`, '/app/src/lib/A.svelte', MARKUP)).toEqual(
			[]
		);
	});
});
