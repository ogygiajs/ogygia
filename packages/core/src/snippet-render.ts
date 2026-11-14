import { render } from 'svelte/server';
import type { Snippet } from 'svelte';
import { BROWSER } from 'esm-env';
import RenderSnippet from './RenderSnippet.svelte';
import { kit_render_context } from './server/kit-context.ts';
import { OgygiaError } from './messages/island.ts';
import { install_snippet_renderer, type SnippetRenderer } from './region-snippet.ts';

/**
 * THE SERVER RENDER OF REGION SNIPPETS. A bare snippet freezes to the HTML it renders, through a
 * tiny component (`RenderSnippet.svelte`: `{@render snippet()}`) and `svelte/server`'s public
 * `render()`. This module imports a `.svelte` file, so only code that already loads them imports it
 * (ogygia's server hooks, `region`, Region.svelte), each calling {@link SnippetRender.install}; the
 * snippet codec (region-snippet.ts) asks for the installed renderer and never imports one, so it
 * stays importable from plain Node.
 */
export class SnippetRender implements SnippetRenderer {
	freeze(snippet: Snippet, label?: string): string {
		try {
			return render(RenderSnippet, { props: { snippet }, context: kit_render_context() }).body;
		} catch (e) {
			throw new OgygiaError('function_prop_cannot_cross', {
				where: label ? `prop \`${label}\`` : 'a function prop',
				reason: e instanceof Error ? e.message : String(e)
			});
		}
	}

	/** Installs the renderer on the server (nothing in the browser, so `svelte/server` stays out
	 *  of client bundles). A called import: the package is side-effect free. */
	static install(): void {
		if (!BROWSER) install_snippet_renderer(new SnippetRender());
	}
}
