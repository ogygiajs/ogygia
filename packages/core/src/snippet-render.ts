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
	freeze(snippet: Snippet, label?: string): string {
		try {
			return BROWSER
				? untrack(() => SnippetRender.#browser_html(snippet))
				: render(RenderSnippet, { props: { snippet }, context: kit_render_context() }).body;
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
			return target.innerHTML;
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
