import { mount, unmount, untrack, type Snippet } from 'svelte';
import { render } from 'svelte/server';
import { BROWSER } from 'esm-env';
import RenderSnippet from './RenderSnippet.svelte';
import { kit_render_context } from './server/kit-context.ts';
import { OgygiaError } from './messages/island.ts';
import { install_snippet_renderer, type SnippetRenderer } from './region-snippet.ts';

/**
 * THE RENDER OF REGION SNIPPETS, on both legs. A bare snippet freezes to the HTML it renders,
 * through a tiny component (`RenderSnippet.svelte`: `{@render snippet()}`): on the server through
 * `svelte/server`'s public `render()`, in the browser mounted once into an element no page holds.
 * This module imports a `.svelte` file, so only code that already loads them imports it (ogygia's
 * server hooks, `region`, Region.svelte), each calling {@link SnippetRender.install}; the snippet
 * codec (region-snippet.ts) asks for the installed renderer and never imports one, so it stays
 * importable from plain Node.
 */
export class SnippetRender implements SnippetRenderer {
	/** A snippet's frozen HTML: Svelte's server HTML for it, with Svelte's hydration markers taken
	 *  out. The browser writes its mounted DOM the way Svelte's server writes HTML, so both legs
	 *  freeze one snippet to the same bytes, and a hole that holds it has one address on both. */
	freeze(snippet: Snippet, label?: string): string {
		try {
			return BROWSER
				? untrack(() => SnippetRender.#browser_html(snippet))
				: render(RenderSnippet, {
						props: { snippet },
						context: kit_render_context()
					}).body.replace(SVELTE_MARKER_G, '');
		} catch (e) {
			throw new OgygiaError('function_prop_cannot_cross', {
				where: label ? `prop \`${label}\`` : 'a function prop',
				reason: e instanceof Error ? e.message : String(e)
			});
		}
	}

	static #browser_html(snippet: Snippet): string {
		const target = document.createElement('div');
		const app = mount(RenderSnippet, { target, props: { snippet } });
		try {
			return server_html_of(target).join('');
		} finally {
			// oxlint-disable-next-line ogygia/no-silent-failures -- unmount's promise is its outros ending; it never rejects
			void unmount(app);
		}
	}

	/** Installs the renderer. A called import: the package is side-effect free. */
	static install(): void {
		install_snippet_renderer(new SnippetRender());
	}
}

const SVELTE_MARKER_G = /<!--(?:\[[!\d-]*|\]|)-->/g;
const SVELTE_MARKER = /^(?:\[[!\d-]*|\]|)$/;
const VOID_ELEMENT =
	/^(?:area|base|br|col|command|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)$/;
const RAW_TEXT = /^(?:script|style)$/;
const ATTR_ESCAPE_G = /[&"<]/g;
const TEXT_ESCAPE_G = /[&<]/g;
const ESCAPED: Readonly<Record<string, string>> = { '&': '&amp;', '"': '&quot;', '<': '&lt;' };
const escape_char = (c: string) => ESCAPED[c]!;

function server_html_of(parent: Node, out: string[] = []): string[] {
	for (let n = parent.firstChild; n; n = n.nextSibling) {
		if (n.nodeType === 3) {
			const raw = parent.nodeType === 1 && RAW_TEXT.test((parent as Element).localName);
			out.push(raw ? n.nodeValue! : n.nodeValue!.replace(TEXT_ESCAPE_G, escape_char));
		} else if (n.nodeType === 8) {
			if (!SVELTE_MARKER.test(n.nodeValue!)) out.push(`<!--${n.nodeValue}-->`);
		} else if (n.nodeType === 1) {
			const el = n as Element;
			out.push(`<${el.localName}`);
			for (const a of Array.from(el.attributes))
				out.push(` ${a.name}="${a.value.replace(ATTR_ESCAPE_G, escape_char)}"`);
			if (VOID_ELEMENT.test(el.localName)) out.push('/>');
			else {
				out.push('>');
				server_html_of(el, out);
				out.push(`</${el.localName}>`);
			}
		}
	}
	return out;
}
