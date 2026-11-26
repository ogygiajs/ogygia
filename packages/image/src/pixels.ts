/**
 * The pixels: sharp, for the two moments that touch them. At compile a source is measured and its
 * placeholder made (./vite/plan.ts); at settle one recipe is encoded (./settle.ts). Both read the
 * source the same way: EXIF orientation applied, then the source's operations, then the box.
 *
 * @packageDocumentation
 */
import sharp, { type Metadata, type Sharp } from 'sharp';
import { DEFAULT_AVIF_EFFORT, DEFAULT_QUALITY } from './config.ts';
import type { ImageFormat, ImageOps } from './descriptor.ts';
import { FRAME_PIXELS_MAX, REMOTE_TAIL } from './recipe.ts';

/** The libvips version the files are made with: part of every cache key. */
export const VIPS_VERSION: string = sharp.versions.vips;

/** A source's shown size: its stored size turned by its EXIF orientation and its operations. */
export function shown_size(
	meta: Metadata,
	ops: ImageOps,
	animated: boolean
): { width: number; height: number } {
	let w = meta.width;
	let h = animated && meta.pageHeight ? meta.pageHeight : meta.height;
	// @why EXIF orientations 5–8 store the picture turned a quarter, so its stored width is its shown height (test: packages/image/test/plan.test.ts › EXIF orientation is applied: a portrait stored sideways reports its shown size)
	if ((meta.orientation ?? 1) >= 5) [w, h] = [h, w];
	if (ops.rotate && Math.abs(ops.rotate) % 180 === 90) [w, h] = [h, w];
	return { width: w, height: h };
}

/** The source's metadata, every frame counted. Its header only: no pixel is read, so no limit
 *  applies (see {@link too_large}). */
export function metadata_of(bytes: Uint8Array): Promise<Metadata> {
	return sharp(bytes, { animated: true, limitInputPixels: false }).metadata();
}

export { FRAME_PIXELS_MAX };

/** The most pixels an animation's frames may add up to. sharp reads the frames one after another,
 *  so memory stays small; the time an encode takes grows with them (a 1200 × 800 recording of 300
 *  frames, 288 million pixels, takes about half a second). */
export const ANIMATION_PIXELS_MAX: number = 2 ** 32;

/** The pixels an encode of a source with `meta` reads: one frame, or every frame of an
 *  animation. */
export function pixels_read(meta: Metadata): number {
	return meta.width * meta.height;
}

/** Why a source with `meta` is too large to encode, or null. */
export function too_large(meta: Metadata): string | null {
	const pages = meta.pages ?? 1;
	const frame = meta.width * (pages > 1 && meta.pageHeight ? meta.pageHeight : meta.height);
	if (frame > FRAME_PIXELS_MAX)
		return `${meta.width} × ${frame / meta.width} pixels a frame, past the ${FRAME_PIXELS_MAX} one frame may have`;
	if (pages > 1 && frame * pages > ANIMATION_PIXELS_MAX)
		return `${pages} frames of ${meta.width} × ${frame / meta.width} pixels, ${frame * pages} in all, past the ${ANIMATION_PIXELS_MAX} an animation may have`;
	return null;
}

/** The source → `width` × `height`, cut to that box around `position`. `pixels` is the most it
 *  reads: one frame, or every frame of an animation ({@link pixels_read}). */
export function pipeline(
	bytes: Uint8Array,
	ops: ImageOps,
	animated: boolean,
	width: number,
	height: number,
	position?: string,
	pixels: number = FRAME_PIXELS_MAX
): Sharp {
	let img = sharp(bytes, { animated, limitInputPixels: pixels }).autoOrient();
	if (ops.rotate) img = img.rotate(ops.rotate);
	if (ops.flip) img = img.flip();
	if (ops.flop) img = img.flop();
	if (ops.grayscale) img = img.grayscale();
	if (ops.blur) img = img.blur(ops.blur);
	if (ops.sharpen) img = img.sharpen();
	if (ops.normalize) img = img.normalize();
	if (ops.negate) img = img.negate();
	if (ops.gamma) img = img.gamma(ops.gamma);
	if (ops.tint) img = img.tint(ops.tint);
	if (ops.modulate) img = img.modulate(ops.modulate);
	return img.resize({ width, height, fit: 'cover', position: position_of(position) });
}

function position_of(position: string | undefined): string | number {
	if (position === 'attention' || position === 'entropy') return sharp.strategy[position];
	if (position === undefined || position === 'center') return 'centre';
	return position;
}

/** One file's bytes: the source at `width` × `height` in `format`. */
export async function encode(
	bytes: Uint8Array,
	file: {
		width: number;
		height: number;
		format: ImageFormat;
		quality?: number;
		position?: string;
		ops?: ImageOps;
	},
	animated: boolean,
	pixels: number = FRAME_PIXELS_MAX,
	avif_effort: number = DEFAULT_AVIF_EFFORT
): Promise<Buffer> {
	let img = pipeline(
		bytes,
		file.ops ?? {},
		animated,
		file.width,
		file.height,
		file.position,
		pixels
	);
	const q = file.quality;
	if (file.format === 'avif')
		img = img.avif({ quality: q ?? DEFAULT_QUALITY.avif, effort: avif_effort });
	else if (file.format === 'webp')
		img = img.webp({
			quality: q ?? DEFAULT_QUALITY.webp,
			effort: 4,
			...(animated ? { loop: 0 } : {})
		});
	else if (file.format === 'jpeg')
		img = img.jpeg({ quality: q ?? DEFAULT_QUALITY.jpeg, mozjpeg: true });
	else img = img.png({ compressionLevel: 9, ...(q !== undefined ? { quality: q } : {}) });
	return img.toBuffer();
}

const PLACEHOLDER_WIDTH = 16;

/** The placeholder of a source of shown `size`: a 16 px WebP data URL, or undefined for a source
 *  that is not opaque (a blur would show through it). */
export async function placeholder_of(
	bytes: Uint8Array,
	ops: ImageOps,
	size: { width: number; height: number }
): Promise<string | undefined> {
	const w = Math.min(PLACEHOLDER_WIDTH, size.width);
	const h = Math.max(1, Math.round((w * size.height) / size.width));
	const { data } = await pipeline(bytes, ops, false, w, h)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return undefined;
	const tiny = await pipeline(bytes, ops, false, w, h)
		.removeAlpha()
		.webp({ quality: 50, effort: 6 })
		.toBuffer();
	return `data:image/webp;base64,${tiny.toString('base64')}`;
}

/** One recipe's file from its original's bytes (every frame kept when the original moves, its
 *  first only for a `still`), AVIF at `avif_effort`. An original {@link too_large} to read fails, saying why. */
export async function encode_recipe(
	bytes: Uint8Array,
	recipe: {
		width: number;
		height: number;
		format: ImageFormat;
		quality?: number;
		position?: string;
		still?: true;
		ops?: ImageOps;
		tail?: string;
	},
	avif_effort: number = DEFAULT_AVIF_EFFORT
): Promise<Buffer> {
	const meta = await metadata_of(bytes);
	const why = too_large(meta);
	if (why !== null) throw new Error(`the original is too large to read: ${why}`);
	const animated = !recipe.still && (meta.pages ?? 1) > 1;
	const box = recipe.tail?.startsWith(REMOTE_TAIL)
		? within(recipe, shown_size(meta, recipe.ops ?? {}, animated))
		: recipe;
	return encode(bytes, box, animated, pixels_read(meta), avif_effort);
}

function within<T extends { width: number; height: number }>(
	box: T,
	source: { width: number; height: number }
): T {
	const scale = Math.min(1, source.width / box.width, source.height / box.height);
	if (scale === 1) return box;
	return {
		...box,
		width: Math.max(1, Math.floor(box.width * scale)),
		height: Math.max(1, Math.floor(box.height * scale))
	};
}
