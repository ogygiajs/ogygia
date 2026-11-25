/**
 * The image descriptor: what a page holds for one image SOURCE. Plain data (JSON-safe), so it crosses
 * island props, rides `refs()`, sits in frontmatter and is written into a module as a literal. It names
 * no encoded file: `<Img>` decides those at render (the layout, the preset) and the image endpoint
 * makes each one the first time it is asked for.
 *
 * @packageDocumentation
 */
import type { ImagePosition } from './config.ts';

/** A format an image is in: a source's own, or one a page asks for. */
export type ImageFormat = 'avif' | 'webp' | 'png' | 'jpeg' | 'gif' | 'svg' | 'tiff';

/** Pixel operations a source carries (the macro's `ops`), applied before any resize or crop, in this
 *  order. Each is sharp's operation of that name. */
export interface ImageOps {
	rotate?: number;
	flip?: boolean;
	flop?: boolean;
	grayscale?: boolean;
	blur?: number;
	sharpen?: boolean;
	normalize?: boolean;
	negate?: boolean;
	gamma?: number;
	tint?: string;
	modulate?: { brightness?: number; saturation?: number; hue?: number; lightness?: number };
}

/** One image source, ready to render. */
export interface ImageDescriptor {
	/** The source's identity: a hash of its bytes. */
	id: string;
	/** The original file, shipped as an asset: what the image endpoint reads, and what a browser-only
	 *  render shows. */
	src: string;
	/** Intrinsic width, in pixels (after the operations). */
	width: number;
	/** Intrinsic height, in pixels (after the operations). */
	height: number;
	/** The source's own format. */
	format: ImageFormat;
	/** The placeholder: a tiny (16 px wide) WebP of the image as a data URL
	 *  (`data:image/webp;base64,…`, at most a few hundred bytes), painted behind the image until it loads. Absent
	 *  when the image has none (transparent, an SVG, or `placeholder: false`). */
	ph?: string;
	/** The image moves (an animated GIF or WebP): every file made from it keeps every frame. */
	animated?: boolean;
	/** Encoder quality the source asks for (1–100). */
	quality?: number;
	/** Pixel operations the source carries. */
	ops?: ImageOps;
	/** The presets the build made this source's files for ahead (the macro's `warm`): an `<Img>` of
	 *  one of them names those static files. */
	warm?: string[];
	/** Alt text the source carries (a markdown image's text). */
	alt?: string;
	/** Other candidate sets of this image, each chosen by a media condition: a dark file (the
	 *  macro's `dark`) and the designer's other files (the macro's `art`). One level: a twin's own
	 *  descriptor has no twins. */
	twins?: Twin[];
}

/** Another candidate set of an image, chosen by a media condition: a dark file, an art-directed
 *  crop or file, or (made at render, never stored) the first frame of a moving image. */
export interface Twin {
	/** The media condition this twin answers, like `(max-width: 600px)`. */
	media: string;
	/** Another source; absent: the same source (another crop of it). */
	of?: ImageDescriptor;
	/** The box's shape for this twin only. */
	aspect?: number | string;
	/** Where this twin's crop keeps. */
	position?: ImagePosition;
	/** Display width for this twin only, CSS pixels. */
	width?: number;
	/** The first frame only (the reduced-motion still). Made at render, never stored. */
	still?: true;
	/** A dark twin: also follows the app's theme selectors (`image({ theme })`). */
	theme?: 'dark';
}

/** Is `value` an image descriptor? For a schema: `v.custom<ImageDescriptor>(isImage)` (valibot) or
 *  `z.custom<ImageDescriptor>(isImage)` (zod) for a frontmatter image field. Only a
 *  frontmatter value written with `./` or `../` and an image extension becomes a descriptor (a
 *  missing file fails the build); any other string (`images/share.png`) stays a string, and fails
 *  this. */
export function isImage(value: unknown): value is ImageDescriptor {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Partial<ImageDescriptor>;
	return (
		typeof v.id === 'string' &&
		typeof v.src === 'string' &&
		typeof v.width === 'number' &&
		typeof v.height === 'number' &&
		typeof v.format === 'string'
	);
}
