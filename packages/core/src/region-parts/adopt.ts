import { createRawSnippet, type Snippet } from 'svelte';

type Setup = (el: Element, hydrated: boolean) => void | (() => void);

class AdoptedElement {
	readonly #attrs: () => string;
	readonly #setup: Setup | undefined;
	#rendered = false;

	constructor(attrs: () => string, setup: Setup | undefined) {
		this.#attrs = attrs;
		this.#setup = setup;
	}

	render = (): string => {
		this.#rendered = true;
		return `<ogygia-region${this.#attrs()}></ogygia-region>`;
	};

	setup = (el: Element): void | (() => void) => this.#setup?.(el, !this.#rendered);
}

/** A region element the browser adopts as the server wrote it: the server writes its attributes and
 *  inner HTML; the browser renders it empty and hands `setup` the element, and whether hydration
 *  found it (the server's) or the browser rendered it. */
export function adopt_region(
	attrs: () => string,
	inner?: (renderer: never) => void,
	setup?: Setup
): Snippet {
	return (import.meta.env?.SSR ?? typeof window === 'undefined')
		? (((renderer: { push(html: string): void }) => {
				renderer.push(`<ogygia-region${attrs()}>`);
				inner?.(renderer as never);
				renderer.push('</ogygia-region>');
			}) as unknown as Snippet)
		: createRawSnippet(() => new AdoptedElement(attrs, setup));
}
