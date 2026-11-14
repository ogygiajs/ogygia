// (not ./internal/server: that entry reaches Kit's `$app/*`, and this runs in a plain Node config)
import { next_tag } from '@ogygia/core/internal/instruments';
import { dedent } from '@ogygia/core/plugin/utils';

/** Exact inverse of `escape_svelte` (shiki.ts). In escaped text every backslash was produced by one
 *  of its three rules (`\\` ← `\`, `` \` `` ← `` ` ``, `\$` ← `${`'s `$`), so dropping each backslash
 *  and keeping the escaped char is a total, lossless decode. */
export function unescape_svelte(escaped: string): string {
	return escaped.replace(/\\([\s\S])/g, '$1');
}

const FENCE_EMBED_RE = /\{@html `((?:[^`\\]|\\[\s\S])*)`\}/g;

/** Where a Svelte source's module script is (`<script module>`, or the legacy `context="module"`),
 *  its tag read by core's tag walk as Svelte reads it: its start, the end of its start tag (where
 *  its text starts), where its text ends, and just past its end tag. Null when it has none. */
export function module_script(
	code: string
): { start: number; text: number; text_end: number; end: number } | null {
	for (let t = next_tag(code, 'script', 0); t !== null; t = next_tag(code, 'script', t.next)) {
		if (t.attr('module') === undefined && t.attr('context') !== 'module') continue;
		const close = code.indexOf('>', t.next);
		if (t.next >= code.length || close === -1) return null;
		return { start: t.start, text: t.end, text_end: t.next, end: close + 1 };
	}
	return null;
}

export type RegionEmit = {
	code: string;
	/** The serialized document HTML (what `__ogygia_region.html` carries) — for tests/tools. */
	html: string;
};

function split_module(code: string): { module_body: string; template: string } {
	const mod = module_script(code);
	if (mod === null) return { module_body: '', template: code };
	return {
		module_body: code.slice(mod.text, mod.text_end),
		template: `${code.slice(0, mod.start)}${code.slice(mod.end)}`
	};
}

// oxlint-disable-next-line ogygia/one-markup-walk -- Svelte source, not HTML: a component's name keeps its case and its dots, which HTML folds
const COMPONENT_TAG_RE = /<([A-Z][\w$]*(?:\.[\w$]+)*|[a-z_$][\w$]*(?:\.[\w$]+)+)(?=[\s/>])/;

/** The first component tag (`<Foo`, `<Foo.Bar`, `<ui.Button`) in a compiled module; null when
 *  none. A region keeps one as an inert element (a `.md` corpus mentions them); `md()` refuses it. */
export function component_tag_in(code: string): string | null {
	const m = COMPONENT_TAG_RE.exec(split_module(code).template.replace(FENCE_EMBED_RE, ' '));
	return m ? m[1]! : null;
}

/**
 * Re-emit a compiled content module as a serialized region: content crosses into Svelte as data,
 * never as template source. `code` is the post-mdsvex, post-island-transform module; `module_lines`
 * are the module-script exports the caller injects anyway (`__ogygia_source`, …). The result:
 *
 * ```svelte
 * <script context="module">
 *   …the original metadata export…
 *   export const __ogygia_region = { html: "<the whole document, one JSON string>" };
 * </script>
 * {@html __ogygia_region.html}
 * ```
 *
 * The fence embeds are unwrapped (the codec is lossless), and the prose is text: its braces become
 * entities, a `<svelte:…>` tag shows as written, a capitalized `<Widget>` stays an inert element.
 * The template holds one reference and no content, so nothing in the content can be read as
 * Svelte. Only an instance `<script>` keeps the component path: then it returns `null`.
 */
export function try_region_emit(code: string, module_lines: string[]): RegionEmit | null {
	const { module_body, template } = split_module(code);

	if (next_tag(template, 'script', 0) !== null) return null;

	const fences: string[] = [];
	let skeleton = template.replace(FENCE_EMBED_RE, (_, inner: string) => {
		fences.push(unescape_svelte(inner));
		return `\0${fences.length - 1}\0`;
	});

	skeleton = skeleton.replace(/<(\/?)(svelte:[a-z]+)/g, '&lt;$1$2');

	const prose = skeleton.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

	const html = prose.replace(/\0(\d+)\0/g, (_, n: string) => fences[Number(n)]!).trim();
	// @why a `</script>` or `<!--` in the content would end the module script: every `<` in the JSON literal is `<` (test: test/region-emit.test.ts › JSON-escapes </script> in content so the module script cannot terminate early)
	const html_json = JSON.stringify(html).replace(/</g, '\\u003C');

	const lines = [...module_lines, `export const __ogygia_region = { html: ${html_json} };`].join(
		'\n'
	);
	const script = `${dedent`
		<script context="module">
		${module_body}
		${lines}
		</script>
	`}\n`;
	return { code: `${script}{@html __ogygia_region.html}\n`, html };
}
