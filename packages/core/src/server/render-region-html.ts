/**
 * A held region's server render to HTML (`__renderHtml` of a region binding): the component's body,
 * prefixed with its island's stylesheet links and the region-CSS links its nested regions put in the
 * head — the page never imported a server-picked component, so its CSS is on no page stylesheet.
 * ONE copy for every island (the compiler used to inline this into each binding: hundreds of copies
 * of the same code in the server bundle, parsed at every cold start).
 *
 * A fresh render root: it sees the page of the render (server/render-page.ts) like every other root
 * ogygia starts — awaited first, so a region a remote call renders reads its page's `page.data`.
 */
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { region_css } from 'ogygia:server';
import { region_css_tags } from './html-scan.ts';
import { kit_page_facts_tail, kit_page_ready, kit_render_context } from './kit-context.ts';
import { nested_context } from '../nested.ts';

const REGION_CSS_ATTR = 'data-ogygia-region-css';
/** context.ts's LAKE key (`isInLake`), by its global name — context.ts reaches virtual modules. */
const LAKE_SUBTREE_KEY = Symbol.for('ogygia.lake-subtree');

export async function render_region_html(
	component: Component<Record<string, unknown>>,
	module_url: string,
	props: Record<string, unknown>,
	/** the region wakes: its component hydrates over this HTML */
	wakes = false
): Promise<string> {
	await kit_page_ready();
	// (its HTML reaches the page opaque to Kit — fetched, or morphed in — so it renders as a lake's
	// inside: its islands emit real regions the runtime wakes, as region.ts's inline render does)
	const base: Map<unknown, unknown> = kit_render_context();
	base.set(LAKE_SUBTREE_KEY, true);
	// A region that wakes renders in the context its hydrate gets (`nested_context`, both legs), so
	// the regions inside it take the same branch on both: inline, the nested rule
	// (test/browser/held-region-hole.test.ts)
	const context = wakes ? nested_context(base) : base;
	const r = await render(component, { props, context });
	let own = '';
	for (const href of region_css(module_url))
		own = `${own}<link rel="stylesheet" href="${href}" ${REGION_CSS_ATTR}>`;
	return `${own}${region_css_tags(r.head)}${r.body}${kit_page_facts_tail()}`;
}
