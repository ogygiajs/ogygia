/** What the answer carries of the render's head: its islands' graph and their CSS ('' for none). */
export declare function hole_head(head: string, base: URL | undefined): string;
/** Every region-CSS tag in the head, as written (`<link … data-ogygia-region-css>` or
 *  `<style data-ogygia-region-css="…">…</style>`). */
export declare function head_region_css(head: string): string;
/** One graph script for the answer (or '' when the render's head carries none). */
export declare function hole_graph_script(head: string, base: URL): string;
