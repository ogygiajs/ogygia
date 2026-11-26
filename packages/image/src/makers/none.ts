/**
 * The maker of an app whose encoders make no file at its endpoint: it encodes nothing. A PNG asked
 * for as it is (its own size, no crop place, no operation, no still) is handed back as it is: a live
 * share card's own-size file, drawn by satori and resvg, which need no encoder. Every other ask
 * fails, coded (`image_settle_failed`, saying why). Holds nothing a runtime could lack.
 *
 * @packageDocumentation
 */
import type { Maker } from '../maker.ts';
import type { ParsedRecipe } from '../recipe.ts';

const PNG_HEAD: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether `bytes` are a PNG whose header says `recipe`'s width and height. */
function own_png(bytes: Uint8Array, recipe: ParsedRecipe): boolean {
	if (bytes.length < 24 || PNG_HEAD.some((b, i) => bytes[i] !== b)) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return view.getUint32(16) === recipe.width && view.getUint32(20) === recipe.height;
}

/** One at a time: each ask is answered at once. */
export const parallel: Maker['parallel'] = 1;

/** The PNG itself when `recipe` asks for it as it is; else fails: no encoder makes files here. */
export const make: Maker['make'] = (bytes, recipe) =>
	recipe.format === 'png' &&
	recipe.ops === undefined &&
	recipe.still === undefined &&
	recipe.position === undefined &&
	own_png(bytes, recipe)
		? Promise.resolve(bytes)
		: Promise.reject(new Error('no encoder in image({ encoder }) makes files at this server'));

/** Nothing is kept. */
export const store: Maker['store'] = null;

/** No card drawn here names an image. */
export const fit: Maker['fit'] = null;
