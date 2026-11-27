/**
 * A CARD'S IMAGE, FITTED TO THE CARD. satori and resvg decode every image a card names whole, so
 * their memory grows with its pixels, not its bytes: a 1 MB PNG of 20000 × 20000 pixels takes a draw
 * past 2 GB. So each image is read by sharp before the draw: one past the one-frame limit every
 * encode has ({@link too_large}) is refused from its header, before a pixel is decoded; a larger one
 * is made smaller, to the least size that still covers the card and at most {@link CARD_COVER_TIMES}
 * times its pixels. satori and resvg see a card-sized image and nothing more.
 *
 * @packageDocumentation
 */
import type { Metadata } from 'sharp';
import { metadata_of, pipeline, shown_size, too_large } from '../pixels.ts';
import { image_type } from '../image-type.ts';
import { resvg_draws } from './images.ts';

/** The most pixels an image a card draws keeps, in cards of its card's size. */
export const CARD_COVER_TIMES = 4;

/** The scale that fits a `width` × `height` image to a `card_w` × `card_h` card: the least that
 *  covers it, at most {@link CARD_COVER_TIMES} cards of pixels, never larger than 1. */
export function card_scale(width: number, height: number, card_w: number, card_h: number): number {
	const cover = Math.max(card_w / width, card_h / height);
	const pixels = Math.sqrt((CARD_COVER_TIMES * card_w * card_h) / (width * height));
	return Math.min(1, cover, pixels);
}

const DRAWN_AS_IS: ReadonlySet<string | undefined> = new Set(['srgb', 'b-w']);

function drawn_as_is(bytes: Uint8Array, meta: Metadata): boolean {
	return (
		resvg_draws(bytes) &&
		DRAWN_AS_IS.has(meta.space) &&
		meta.depth === 'uchar' &&
		meta.hasProfile !== true &&
		(meta.orientation ?? 1) === 1
	);
}

/** `bytes` (a PNG, JPEG, GIF, WebP, AVIF or TIFF) as an image a `card_w` × `card_h` card draws:
 *  kept when it is no larger than the card needs and resvg draws it as it is (an 8-bit sRGB or
 *  grey PNG, JPEG or GIF with no colour profile and no EXIF turn), else made again at the size the
 *  card needs, as 8-bit sRGB (a PNG when it has alpha, a JPEG when not): so a WebP, AVIF, TIFF,
 *  CMYK JPEG, 16-bit PNG or a file with a colour profile is always made again. Throws, saying why,
 *  when its header does not read or it is past the one-frame limit. */
export async function fit_to_card(
	bytes: Uint8Array,
	card_w: number,
	card_h: number
): Promise<{ bytes: Uint8Array; type: string }> {
	const type = image_type(bytes);
	if (type === null) throw new Error('its bytes are no PNG, JPEG, GIF, WebP, AVIF or TIFF');
	const meta = await metadata_of(bytes).catch((e: unknown) => {
		throw new Error(`its header does not read: ${(e as Error).message}`);
	});
	const why = too_large(meta);
	if (why !== null) throw new Error(why);
	const { width, height } = shown_size(meta, {}, (meta.pages ?? 1) > 1);
	const scale = card_scale(width, height, card_w, card_h);
	if (scale === 1 && drawn_as_is(bytes, meta)) return { bytes, type };
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));
	const img = pipeline(bytes, {}, false, w, h).toColourspace('srgb');
	const out = meta.hasAlpha ? img.png() : img.jpeg({ quality: 90 });
	return {
		bytes: new Uint8Array(await out.toBuffer()),
		type: meta.hasAlpha ? 'image/png' : 'image/jpeg'
	};
}
