// A COMPONENT'S SCRIPT AND STYLE BLOCKS ARE READ AS MARKUP (#1370). Every compiler pass that splits a
// `.svelte` source into its blocks reads the opening tag the way Svelte's markup is read: a value may
// hold `>` or the other quote, an attribute may be unquoted or in any case, a comment holds no block,
// a block's text holds no tag, and `<scripts>` is not `<script>`.
import { describe, expect, test } from 'vitest';
import { og_js_regions } from '../src/compiler/parse/scan.ts';
import { collect_flag_sites } from '../src/compiler/flags.ts';
import { svelteModuleHasTransportable } from '../src/compiler/transportables.ts';
import { blank_styles } from '../src/compiler/blank-styles.ts';
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

describe('flag sites are read in every script', () => {
	test('a script whose attribute holds `>`', () => {
		const src = dedent`
			<script lang="ts" data-note="a>b">
				import { flag } from '@ogygia/flags';
				export const beta = flag('beta');
			</script>
		`;
		const sites = collect_flag_sites(src, '/app/src/lib/A.svelte', 'src/lib/A.svelte');
		expect(sites.map((s) => [s.name, s.line])).toEqual([['beta', 3]]);
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
});
