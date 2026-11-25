/**
 * What a recipe NEEDS of whoever makes its file: the box it is made to, whether that cuts the source
 * and where the crop keeps, each pixel operation, the format, and a source not every encoder reads
 * (an AVIF, a GIF, a TIFF, one that moves), a PNG made from another format, and the first frame
 * alone of one that moves (a still). An encoder's capabilities (./capabilities.ts) say which it can make;
 * the namer (../namers/resolve.ts) reads a recipe's needs at render, in the server and the browser.
 *
 * @packageDocumentation
 */
import type { Recipe } from '../recipe.ts';

/** Every need a recipe can carry. */
export const NEEDS = [
	'box',
	'crop',
	'position center',
	'position top',
	'position bottom',
	'position left',
	'position right',
	'position attention',
	'position entropy',
	'rotate quarter',
	'rotate other',
	'flip',
	'flop',
	'grayscale',
	'blur',
	'sharpen',
	'normalize',
	'negate',
	'gamma',
	'tint',
	'modulate brightness',
	'modulate saturation',
	'modulate hue',
	'modulate lightness',
	'format avif',
	'format webp',
	'format png',
	'format jpeg',
	'png from another format',
	'source avif',
	'source gif',
	'source tiff',
	'animated',
	'still'
] as const;

/** One thing a recipe asks of its encoder. */
export type Need = (typeof NEEDS)[number];

const OPS: readonly ('flip' | 'flop' | 'grayscale' | 'sharpen' | 'normalize' | 'negate')[] = [
	'flip',
	'flop',
	'grayscale',
	'sharpen',
	'normalize',
	'negate'
];
const MODULATE: readonly ('brightness' | 'saturation' | 'hue' | 'lightness')[] = [
	'brightness',
	'saturation',
	'hue',
	'lightness'
];

/** A turn of `degrees` as a quarter turn clockwise (90, 180, 270), 0 for none, or null for any
 *  other angle. */
export function quarter(degrees: number): 0 | 90 | 180 | 270 | null {
	const d = ((degrees % 360) + 360) % 360;
	return d === 0 || d === 90 || d === 180 || d === 270 ? d : null;
}

/** What `recipe` needs, in {@link NEEDS} order. */
export function needs_of(recipe: Omit<Recipe, 'src'>): Need[] {
	const has = new Set<string>(['box', `format ${recipe.format}`]);
	if (recipe.crop) has.add('crop');
	const from = recipe.source?.format;
	if (from === 'avif' || from === 'gif' || from === 'tiff') has.add(`source ${from}`);
	if (recipe.format === 'png' && from !== 'png') has.add('png from another format');
	if (recipe.still) has.add('still');
	else if (recipe.source?.animated) has.add('animated');
	const p = recipe.position;
	has.add(p === undefined || p === 'centre' ? 'position center' : `position ${p}`);
	const ops = recipe.ops ?? {};
	if (ops.rotate) has.add(quarter(ops.rotate) === null ? 'rotate other' : 'rotate quarter');
	for (const op of OPS) if (ops[op]) has.add(op);
	if (ops.blur) has.add('blur');
	if (ops.gamma) has.add('gamma');
	if (ops.tint) has.add('tint');
	for (const m of MODULATE) if (ops.modulate?.[m] !== undefined) has.add(`modulate ${m}`);
	return NEEDS.filter((n) => has.has(n));
}
