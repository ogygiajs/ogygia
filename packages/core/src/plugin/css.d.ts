/** Head tags for the components ONE render places (a layout chain + its page or error component):
 *  each component's whole-tree CSS, linked once per request. */
export declare function componentCssHead(components: readonly unknown[]): Promise<string>;
