/** The value of `attr` on `el` or its NEAREST ancestor that has it, crossing shadow-root boundaries (an
 *  island inside a web component's shadow tree still finds the block around the component; a link a
 *  component renders in its shadow tree, the router's `data-sveltekit-reload` around the component). */
export declare function nearest_attr(el: Element, attr: string): string | null;
