/**
 * What each encoder can make: one table over (maker × need), so every row is listed and a test
 * snapshots it. The plugin reads it at build and hands each namer the needs its encoder cannot meet
 * (../namers/resolve.ts); the table itself never ships.
 *
 * Cloudflare's rows are its Images binding's `transform()` fields (`cloudflare`) and its Image
 * Transformations link options (`cloudflare links`, `/cdn-cgi/image/<options>/…`): one set, but a
 * link names no PNG. Vercel's rows are its Image Optimization API (`/_vercel/image?url=…&w=…&q=…`):
 * a width and a quality, the format picked from the browser's `Accept`.
 *
 * @packageDocumentation
 */
import { decisions, type Decisions } from '@ogygia/machine';
import { NEEDS, type Need } from './needs.ts';

/** Who makes a file the table knows: an encoder's endpoint maker, or its links. */
export const ENCODER_NAMES = ['sharp', 'cloudflare', 'cloudflare links', 'vercel'] as const;

/** One row's answer: can it, and as what (the option it maps to, or why not). */
export interface Capability {
	can: boolean;
	as: string;
}

const SHARP_AS: Readonly<Record<Need, string>> = {
	box: "resize fit 'cover'",
	crop: "resize fit 'cover'",
	'position center': "position 'centre'",
	'position top': "position 'top'",
	'position bottom': "position 'bottom'",
	'position left': "position 'left'",
	'position right': "position 'right'",
	'position attention': 'strategy.attention',
	'position entropy': 'strategy.entropy',
	'rotate quarter': 'rotate()',
	'rotate other': 'rotate()',
	flip: 'flip()',
	flop: 'flop()',
	grayscale: 'grayscale()',
	blur: 'blur(sigma)',
	sharpen: 'sharpen()',
	normalize: 'normalize()',
	negate: 'negate()',
	gamma: 'gamma()',
	tint: 'tint()',
	'modulate brightness': 'modulate({ brightness })',
	'modulate saturation': 'modulate({ saturation })',
	'modulate hue': 'modulate({ hue })',
	'modulate lightness': 'modulate({ lightness })',
	'format avif': 'avif()',
	'format webp': 'webp()',
	'format png': 'png()',
	'format jpeg': 'jpeg({ mozjpeg })',
	'png from another format': 'png()',
	'source avif': 'reads AVIF',
	'source gif': 'reads GIF',
	'source tiff': 'reads TIFF',
	animated: '{ animated: true } keeps every frame',
	still: '{ pages: 1 } reads the first frame'
};

const CLOUDFLARE: Readonly<Record<Need, Capability>> = {
	box: { can: true, as: 'fit=cover' },
	crop: { can: true, as: 'fit=cover' },
	'position center': { can: true, as: 'no gravity (the center is the default)' },
	'position top': { can: true, as: 'gravity=top' },
	'position bottom': { can: true, as: 'gravity=bottom' },
	'position left': { can: true, as: 'gravity=left' },
	'position right': { can: true, as: 'gravity=right' },
	'position attention': { can: true, as: 'gravity=auto (saliency)' },
	'position entropy': { can: false, as: 'no gravity keeps the busiest part' },
	'rotate quarter': { can: true, as: 'rotate=90|180|270' },
	'rotate other': { can: false, as: 'rotate takes 90, 180 or 270 only' },
	flip: { can: true, as: 'flip=v' },
	flop: { can: true, as: 'flip=h' },
	grayscale: { can: true, as: 'saturation=0' },
	blur: { can: true, as: 'blur=<radius 1–250> (twice the sigma)' },
	sharpen: { can: true, as: 'sharpen=1' },
	normalize: { can: false, as: 'no option stretches the levels' },
	negate: { can: false, as: 'no option inverts the colors' },
	gamma: {
		can: false,
		as: "gamma is an exposure curve there, not sharp's gamma-correct resize"
	},
	tint: { can: false, as: 'no option tints' },
	'modulate brightness': { can: true, as: 'brightness=<multiplier>' },
	'modulate saturation': { can: true, as: 'saturation=<multiplier>' },
	'modulate hue': { can: false, as: 'no option turns the hue' },
	'modulate lightness': { can: false, as: 'no option adds lightness' },
	'format avif': { can: true, as: 'format=avif (WebP or JPEG past 1200 px a side)' },
	'format webp': { can: true, as: 'format=webp' },
	'format png': { can: true, as: "output({ format: 'image/png' })" },
	'format jpeg': { can: true, as: 'format=jpeg' },
	'png from another format': { can: true, as: "output({ format: 'image/png' })" },
	'source avif': { can: false, as: 'reads AVIF on an Enterprise plan only' },
	'source gif': { can: true, as: 'reads GIF, animations included' },
	'source tiff': { can: true, as: 'reads TIFF (its first page)' },
	animated: { can: true, as: 'anim=true (the default) keeps every frame' },
	still: { can: true, as: 'anim=false keeps the first frame' }
};

const CLOUDFLARE_LINKS: Readonly<Record<Need, Capability>> = {
	...CLOUDFLARE,
	'format png': { can: true, as: "no format= (a PNG source's own format is kept)" },
	'png from another format': { can: false, as: 'format= takes no png' }
};

const VERCEL_RESIZE_ONLY = 'only resizes (w=, q=): no option for it';
const VERCEL_PASSED = 'served as it is: only JPEG, PNG, WebP and AVIF sources are optimized';

const VERCEL: Readonly<Record<Need, Capability>> = {
	box: { can: true, as: 'w=<a width of images.sizes>; the height follows the source' },
	crop: { can: false, as: "no crop: w= keeps the source's shape" },
	'position center': { can: true, as: 'nothing is cut, so nothing to place' },
	'position top': { can: false, as: 'no crop' },
	'position bottom': { can: false, as: 'no crop' },
	'position left': { can: false, as: 'no crop' },
	'position right': { can: false, as: 'no crop' },
	'position attention': { can: false, as: 'no crop' },
	'position entropy': { can: false, as: 'no crop' },
	'rotate quarter': { can: false, as: VERCEL_RESIZE_ONLY },
	'rotate other': { can: false, as: VERCEL_RESIZE_ONLY },
	flip: { can: false, as: VERCEL_RESIZE_ONLY },
	flop: { can: false, as: VERCEL_RESIZE_ONLY },
	grayscale: { can: false, as: VERCEL_RESIZE_ONLY },
	blur: { can: false, as: VERCEL_RESIZE_ONLY },
	sharpen: { can: false, as: VERCEL_RESIZE_ONLY },
	normalize: { can: false, as: VERCEL_RESIZE_ONLY },
	negate: { can: false, as: VERCEL_RESIZE_ONLY },
	gamma: { can: false, as: VERCEL_RESIZE_ONLY },
	tint: { can: false, as: VERCEL_RESIZE_ONLY },
	'modulate brightness': { can: false, as: VERCEL_RESIZE_ONLY },
	'modulate saturation': { can: false, as: VERCEL_RESIZE_ONLY },
	'modulate hue': { can: false, as: VERCEL_RESIZE_ONLY },
	'modulate lightness': { can: false, as: VERCEL_RESIZE_ONLY },
	'format avif': { can: true, as: 'picked from the Accept header (images.formats lists it)' },
	'format webp': { can: true, as: 'picked from the Accept header (images.formats lists it)' },
	'format png': {
		can: false,
		as: "names no format: a browser that takes neither AVIF nor WebP gets the source's own"
	},
	'format jpeg': {
		can: false,
		as: "names no format: a browser that takes neither AVIF nor WebP gets the source's own"
	},
	'png from another format': { can: false, as: 'names no format' },
	'source avif': { can: true, as: 'reads AVIF' },
	'source gif': { can: false, as: VERCEL_PASSED },
	'source tiff': { can: false, as: VERCEL_PASSED },
	animated: { can: false, as: 'an animated source is served as it is, not resized' },
	still: { can: false, as: 'no option keeps one frame' }
};

const TABLES: Readonly<
	Record<Exclude<(typeof ENCODER_NAMES)[number], 'sharp'>, Readonly<Record<Need, Capability>>>
> = {
	cloudflare: CLOUDFLARE,
	'cloudflare links': CLOUDFLARE_LINKS,
	vercel: VERCEL
};

/** What an encoder can make, need by need. */
export const CAPABILITIES: Decisions<
	{ encoder: (typeof ENCODER_NAMES)[number]; need: Need },
	Capability
> = decisions({
	name: 'image encoder capabilities',
	inputs: { encoder: ENCODER_NAMES, need: NEEDS },
	decide: (i): Capability =>
		i.encoder === 'sharp' ? { can: true, as: SHARP_AS[i.need] } : TABLES[i.encoder][i.need]
});

/** The needs `encoder` cannot meet. */
export function cannot(encoder: (typeof ENCODER_NAMES)[number]): Need[] {
	return NEEDS.filter((need) => !CAPABILITIES.decide({ encoder, need }).can);
}
