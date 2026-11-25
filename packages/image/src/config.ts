/**
 * The render settings every `<Img>` reads: the plugin's formats, width ladder and quality, and its
 * named presets. Browser-safe: the plugin hands them to the page as a module
 * (`virtual:ogygia-image/config`), the same on the server and in an island.
 *
 * @packageDocumentation
 */
import type { Twin } from './descriptor.ts';

/** A format a page asks the endpoint to make. */
export type OutputFormat = 'avif' | 'webp' | 'png' | 'jpeg';

/**
 * How the image sits on the page:
 * - `constrained` (default): as wide as `width` (the intrinsic width when left out), shrinking with
 *   its container.
 * - `fullWidth`: the container's whole width, whatever the screen.
 * - `fixed`: exactly `width` × `height` CSS pixels, at 1× and 2× density.
 */
export type ImageLayout = 'constrained' | 'fullWidth' | 'fixed';

/** Where a crop keeps: an edge, the centre, or sharp's smart crops (`attention`: the most striking
 *  part; `entropy`: the busiest). */
export type ImagePosition =
	| 'center'
	| 'centre'
	| 'top'
	| 'bottom'
	| 'left'
	| 'right'
	| 'attention'
	| 'entropy';

/** How a page shows an image: what a preset names, and what `<Img>`'s own props say over it. */
export interface ImagePreset {
	layout?: ImageLayout;
	/** Display width, CSS pixels. */
	width?: number;
	/** Display height, CSS pixels. With `width`, the box the image is cropped to. */
	height?: number;
	/** The box's shape, width / height (`16 / 9`, or `'16/9'`): the files are cropped to it. */
	aspect?: number | string;
	/** Where a crop keeps. Default `center`. */
	position?: ImagePosition;
	/** Replaces the `sizes` the layout derives. */
	sizes?: string;
	/** The page's main image (its LCP): loads first, preloaded from the head. */
	priority?: boolean;
	/** Paint the blur placeholder until the image arrives. Default `true`. */
	placeholder?: boolean;
	/** Name the image for a view transition by its source, so on a client-side navigation it glides
	 *  into the same source on the next page (a thumbnail into the post's hero). At most one per
	 *  source on a page: a name that repeats cancels the page's transition. */
	morph?: boolean;
	/** Encoder quality, 1–100. */
	quality?: number;
	/** The formats to offer, best first. */
	formats?: OutputFormat[];
	/** Art direction: another crop at another media condition, each laid out with its own box
	 *  (`[{ media: '(max-width: 600px)', aspect: '4/5', position: 'attention' }]`). The first whose
	 *  media matches is shown. An `<Img art>` of its own replaces these. */
	art?: Twin[];
}

/** Where the app is served from, as Kit's config says (`paths.base`, `paths.assets`, `appDir`). */
export interface AppPaths {
	base: string;
	assets: string;
	app_dir: string;
}

/** The plugin's render settings, as `<Img>` reads them. */
export interface RenderConfig {
	formats: readonly OutputFormat[];
	breakpoints: readonly number[];
	quality?: number;
	presets: Readonly<Record<string, ImagePreset>>;
	paths: AppPaths;
	/** The build made the files of every warmed preset (`import.meta.og.image(src, { warm })`) as
	 *  static files: `<Img>` names those directly. False in dev, where the endpoint makes them. */
	warmed: boolean;
	/** The only widths the encoder that names live files makes (Vercel's `images.sizes`): every
	 *  file's width is snapped up to one of them, or to the source's whole width. Absent: any. */
	widths?: readonly number[];
	/** `image({ theme })` is set: a dark twin is a second `<picture>` the plugin's stylesheet shows
	 *  by the app's theme selectors, not a `<source media>`. */
	themed?: true;
	/** The app's encoders cannot make the first frame of a moving image (`vercel()` alone): no
	 *  reduced-motion still is offered. */
	stills?: false;
}

export const DEFAULT_BREAKPOINTS: readonly number[] = [320, 480, 640, 960, 1280, 1600, 2048];
export const DEFAULT_FORMATS: readonly OutputFormat[] = ['avif', 'webp'];
/** The quality a lossy file is made at when neither the source nor the page says one. A PNG is
 *  lossless unless a quality is said. */
export const DEFAULT_QUALITY: Readonly<Record<'avif' | 'webp' | 'jpeg', number>> = {
	avif: 60,
	webp: 80,
	jpeg: 80
};

const ASPECT_RE = /^\s*(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)\s*$/;

/** The aspect ratio `aspect` asks for (width / height), or null. */
export function parse_aspect(aspect: number | string | undefined): number | null {
	if (aspect === undefined) return null;
	if (typeof aspect === 'number') return aspect > 0 && Number.isFinite(aspect) ? aspect : null;
	const m = ASPECT_RE.exec(aspect);
	if (!m) return null;
	const w = Number(m[1]);
	const h = Number(m[2]);
	return w > 0 && h > 0 ? w / h : null;
}
