/**
 * A recipe in Vercel's words: its Image Optimization link, `/_vercel/image?url=<original>&w=<w>&q=<q>`.
 * Vercel only resizes: the width must be one of the adapter's `images.sizes` (the recipe's is
 * snapped up to one), the quality one of its `images.qualities` when it lists any, and the format
 * is Vercel's pick from the browser's `Accept`. Only recipes the capability table says Vercel can
 * make reach here.
 *
 * @packageDocumentation
 */
import { DEFAULT_QUALITY } from '../config.ts';
import type { Links } from '../namers/resolve.ts';
import type { Recipe } from '../recipe.ts';
import type { Need } from './needs.ts';

/** What a Vercel link is bound by: the widths and qualities the adapter's `images` allows. */
export interface VercelLimits {
	/** `images.sizes`, ascending. */
	sizes: readonly number[];
	/** `images.qualities`, or null: any quality from 1 to 100. */
	qualities: readonly number[] | null;
}

function quality_of(r: Recipe): number {
	return r.quality ?? DEFAULT_QUALITY[r.format as 'avif' | 'webp'];
}

/** What of `r` the limits refuse (a width past every size, a quality not listed), or undefined. */
export function vercel_unmet(r: Recipe, limits: VercelLimits): string | undefined {
	if (!limits.sizes.some((s) => s >= r.width)) return `width ${r.width} (past every size)`;
	const q = quality_of(r);
	if (limits.qualities !== null && !limits.qualities.includes(q))
		return `quality ${q} (not in qualities)`;
	return undefined;
}

/** Vercel's link code, for the namer: its limits, then its link. */
export const VERCEL_LINKS: Links<{ kind: 'vercel'; cannot: readonly Need[] } & VercelLimits> = {
	unmet: (r, limits) => vercel_unmet(r, limits),
	link: (r, limits) => vercel_link(r, limits)!
};

/** The Image Optimization link of `r`, or null when its limits refuse it. The original is `r.src`
 *  (a path from the deployment's root, or a full URL), escaped whole. */
export function vercel_link(r: Recipe, limits: VercelLimits): string | null {
	if (vercel_unmet(r, limits) !== undefined) return null;
	const w = limits.sizes.find((s) => s >= r.width)!;
	return `/_vercel/image?url=${encodeURIComponent(r.src)}&w=${w}&q=${quality_of(r)}`;
}
