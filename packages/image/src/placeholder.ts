/**
 * A placeholder → the CSS that paints it. The placeholder is a tiny image made at build and kept in
 * the descriptor as a data URL, so rendering it is string work: no decode, no client script.
 *
 * @packageDocumentation
 */

/** The inline style that paints the placeholder `url` behind the image, or '' for none. */
export function placeholder_style(url: string | undefined): string {
	if (!url) return '';
	return `background-image:url(${url});background-size:cover;background-repeat:no-repeat`;
}
