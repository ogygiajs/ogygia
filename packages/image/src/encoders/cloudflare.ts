/**
 * A recipe in Cloudflare's words: its Image Transformations link
 * (`/cdn-cgi/image/<options>/<original>`), and the same steps as Images binding `transform()` calls,
 * in sharp's order. Only recipes the capability table says Cloudflare can make reach here.
 *
 * @packageDocumentation
 */
import { DEFAULT_QUALITY } from '../config.ts';
import type { Recipe } from '../recipe.ts';
import type { Links } from '../namers/resolve.ts';
import { quarter, type Need } from './needs.ts';

/** One Images binding `transform()` call's fields. */
export interface CloudflareTransform {
	width?: number;
	height?: number;
	fit?: 'cover' | 'crop';
	gravity?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
	rotate?: 90 | 180 | 270;
	flip?: 'h' | 'v' | 'hv';
	saturation?: number;
	brightness?: number;
	blur?: number;
	sharpen?: number;
}

/** The steps of one recipe: the transforms in order, then the output. */
export interface CloudflareSteps {
	transforms: CloudflareTransform[];
	output: {
		format: `image/${'avif' | 'webp' | 'png' | 'jpeg'}`;
		quality?: number;
		/** The first frame only (a still). */
		anim?: false;
	};
}

const GRAVITY: Readonly<Record<string, CloudflareTransform['gravity']>> = {
	top: 'top',
	bottom: 'bottom',
	left: 'left',
	right: 'right',
	attention: 'auto'
};
const BLUR_MAX = 250;

/** The version of {@link cloudflare_steps}: a file the binding made is kept under it, so a change
 *  to the steps (which bumps it) never serves a file made the old way. */
export const STEPS_VERSION = 2;

function fit_of(r: Omit<Recipe, 'src'>): 'cover' | 'crop' {
	return r.from === 'remote' ? 'crop' : 'cover';
}

function flip_of(
	flip: boolean | undefined,
	flop: boolean | undefined
): CloudflareTransform['flip'] {
	if (flip && flop) return 'hv';
	if (flip) return 'v';
	return flop ? 'h' : undefined;
}

function quality_of(r: Omit<Recipe, 'src'>): number | undefined {
	if (r.quality !== undefined) return r.quality;
	return r.format === 'png' ? undefined : DEFAULT_QUALITY[r.format as 'avif' | 'webp' | 'jpeg'];
}

/** The binding steps of `r`: mirror, then turn, then the box, then tone, blur and sharpen on the
 *  box's pixels, as sharp does. */
export function cloudflare_steps(r: Omit<Recipe, 'src'>): CloudflareSteps {
	const ops = r.ops ?? {};
	const transforms: CloudflareTransform[] = [];
	const flip = flip_of(ops.flip, ops.flop);
	if (flip) transforms.push({ flip });
	const rotate = ops.rotate ? quarter(ops.rotate) : 0;
	if (rotate) transforms.push({ rotate });
	const gravity = r.position === undefined ? undefined : GRAVITY[r.position];
	transforms.push({
		width: r.width,
		height: r.height,
		fit: fit_of(r),
		...(gravity ? { gravity } : {})
	});
	const tone: CloudflareTransform = {};
	const saturation = ops.grayscale ? 0 : ops.modulate?.saturation;
	if (saturation !== undefined) tone.saturation = saturation;
	if (ops.modulate?.brightness !== undefined) tone.brightness = ops.modulate.brightness;
	if (ops.blur) tone.blur = Math.min(BLUR_MAX, Math.max(1, Math.round(ops.blur * 2)));
	if (ops.sharpen) tone.sharpen = 1;
	if (Object.keys(tone).length) transforms.push(tone);
	const quality = quality_of(r);
	return {
		transforms,
		output: {
			format: `image/${r.format as 'avif' | 'webp' | 'png' | 'jpeg'}`,
			...(quality !== undefined ? { quality } : {}),
			...(r.still ? { anim: false as const } : {})
		}
	};
}

/** The Image Transformations link of `r`: `/cdn-cgi/image/<options>/<original>`, at the zone's
 *  root, its options in one fixed order (one URL per file, for the CDN's key). `format=` takes no
 *  `png`: a PNG (from a PNG source only) names no format and keeps the source's. The original is
 *  `r.src`: a path from the zone's root, or a full URL. */
export function cloudflare_link(r: Recipe): string {
	const { transforms, output } = cloudflare_steps(r);
	const all: CloudflareTransform = Object.assign({}, ...transforms) as CloudflareTransform;
	const opts = [`width=${r.width}`, `height=${r.height}`, `fit=${fit_of(r)}`];
	if (all.gravity) opts.push(`gravity=${all.gravity}`);
	if (output.quality !== undefined) opts.push(`quality=${output.quality}`);
	if (r.format !== 'png') opts.push(`format=${output.format.slice('image/'.length)}`);
	if (all.rotate) opts.push(`rotate=${all.rotate}`);
	if (all.flip) opts.push(`flip=${all.flip}`);
	if (all.saturation !== undefined) opts.push(`saturation=${all.saturation}`);
	if (all.brightness !== undefined) opts.push(`brightness=${all.brightness}`);
	if (all.blur !== undefined) opts.push(`blur=${all.blur}`);
	if (all.sharpen !== undefined) opts.push(`sharpen=${all.sharpen}`);
	if (output.anim === false) opts.push('anim=false');
	const src = /^[a-z][a-z\d+.-]*:\/\//i.test(r.src) ? `/${r.src}` : r.src;
	return `/cdn-cgi/image/${opts.join(',')}${src.startsWith('/') ? src : `/${src}`}`;
}

/** Cloudflare's link code, for the namer: no limits past the capability table. */
export const CLOUDFLARE_LINKS: Links<{ kind: 'cloudflare'; cannot: readonly Need[] }> = {
	unmet: () => undefined,
	link: (r) => cloudflare_link(r)
};
