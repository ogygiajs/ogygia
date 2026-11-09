/** Rewrite the relative `entry` / `src` / `endpoint` / region-css `href` values in `html` to root-absolute
 *  paths resolved against `base` (the endpoint request URL). */
export declare function absolutize_hole_html(html: string, base: URL): string;
