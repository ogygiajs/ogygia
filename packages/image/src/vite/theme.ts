/**
 * The theme stylesheet (`virtual:ogygia-image/theme.css`, imported by `<Img>`): with
 * `image({ theme })`, an image with a dark file renders two `<picture>`s, `data-og-theme="light"`
 * and `"dark"`, and this shows one. `<source media>` cannot read an attribute, so the choice is CSS:
 * the dark picture shows when the app's dark selector matches, or when the system prefers dark and
 * the light selector does not; the light one otherwise. A hidden picture's `<img>` is lazy (unless
 * the image is a priority one), and a lazy image that is not rendered is never fetched. A static
 * asset, so a strict CSP allows it; empty without `theme`, so no other app pays for it.
 *
 * @packageDocumentation
 */
import { dedent, OG_THEME } from '@ogygia/core/contract';
import type { ImageTheme } from './options.ts';

const LIGHT = `picture[${OG_THEME}='light']`;
const DARK = `picture[${OG_THEME}='dark']`;

/** The stylesheet for `theme`, or an empty one. */
export function theme_css(theme: ImageTheme | undefined): string {
	if (theme === undefined) return '';
	const dark = `:is(${theme.dark})`;
	const light = `:is(${theme.light})`;
	return dedent`
		@media not all and (prefers-color-scheme: dark) {
			${DARK}:not(${dark} *) { display: none; }
			${dark} ${LIGHT} { display: none; }
		}
		@media (prefers-color-scheme: dark) {
			${light} ${DARK}:not(${dark} *) { display: none; }
			${LIGHT}:not(${light} *) { display: none; }
			${dark} ${LIGHT} { display: none; }
		}
	`;
}
