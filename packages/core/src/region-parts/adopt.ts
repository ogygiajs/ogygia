import { createRawSnippet, type Snippet } from 'svelte';

/** A region element the browser adopts as the server wrote it: the server writes its attributes and
 *  inner HTML; the browser renders it empty and hands `setup` the element hydration found. */
export function adopt_region(
	attrs: () => string,
	inner?: (renderer: never) => void,
	setup?: (el: Element) => void | (() => void)
): Snippet {
	return (import.meta.env?.SSR ?? typeof window === 'undefined')
		? (((renderer: { push(html: string): void }) => {
				renderer.push(`<ogygia-region${attrs()}>`);
				inner?.(renderer as never);
				renderer.push('</ogygia-region>');
			}) as unknown as Snippet)
		: createRawSnippet(() => ({
				render: () => `<ogygia-region${attrs()}></ogygia-region>`,
				setup
			}));
}
