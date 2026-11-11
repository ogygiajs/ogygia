import type { Component } from 'svelte';
import { getContext, setContext } from 'svelte';
import type { Site } from './site.ts';

const KEY = Symbol.for('ogygia.content.shell');

/** Element-override map: markdown tag name → the component that renders it (via `SiteSlot`). */
export type ComponentMap = Record<string, Component<Record<string, unknown>>>;

export type ShellContext = {
	/** Optional: absent on the leak-free path (corpus server-only, nav fed as data). Bricks that need
	 *  it (a `SiteSlot` component override) fall back to `components` / plain behavior. */
	site?: Site;
	base: string;
	components?: ComponentMap;
	/** The shell's brand/site name — bricks use it to suffix the document `<title>`. */
	title?: string;
};

export function set_shell_context(ctx: ShellContext): void {
	setContext(KEY, ctx);
}

/** The shell's context, for a brick inside `<Shell>`: the site without passing it down as props.
 *  The shell sets it once; a brick given explicit props (used outside a shell) needs none. */
export function get_shell_context(): ShellContext | undefined {
	return getContext<ShellContext | undefined>(KEY);
}
