/**
 * The namer of an app whose encoders are not all `sharp()`: for each recipe, the first encoder whose
 * links can make it names it (its link), else the endpoint makes it when its maker can (null: the
 * server signs the endpoint's URL), else the render fails `image_encoder_cannot`, naming the encoder
 * and the need. The plugin writes the plan at build from the capability table
 * (../encoders/capabilities.ts), so the table never ships, and hands it the link code of the
 * platforms the plan names only, so a bundle holds no other platform's. A link may also be bound by
 * the encoder's own limits (Vercel's sizes and qualities). In dev no CDN runs: every file is the
 * endpoint's (sharp), and the same check fails where production would.
 *
 * @packageDocumentation
 */
import { needs_of, type Need } from '../encoders/needs.ts';
import type { VercelLimits } from '../encoders/vercel.ts';
import type { Namer, Recipe } from '../recipe.ts';
import { RenderError } from '../render-messages.ts';

/** One encoder that names its own links: whose, the needs they cannot meet, and its limits. */
export type LinkPlan =
	| { kind: 'cloudflare'; cannot: readonly Need[] }
	| ({ kind: 'vercel'; cannot: readonly Need[] } & VercelLimits);

/** A platform's link code: what of a recipe its limits refuse, and the recipe's link. */
export interface Links<P extends LinkPlan> {
	/** What of `recipe` the plan's limits refuse, or undefined. */
	unmet(recipe: Recipe, plan: P): string | undefined;
	/** The link of `recipe`, which the limits allow. */
	link(recipe: Recipe, plan: P): string;
}

/** The link code of each platform a plan names. */
export type LinkCode = { [K in LinkPlan['kind']]?: Links<Extract<LinkPlan, { kind: K }>> };

/** What a namer resolves by, written by the plugin. */
export interface NamerPlan {
	/** The encoders listed, as `image({ encoder })` names them (`cloudflare()`). */
	encoders: string;
	/** Each encoder that names its own links, in order. */
	links: readonly LinkPlan[];
	/** The needs the endpoint's maker cannot meet, or null: no maker in this runtime. */
	endpoint: readonly Need[] | null;
	/** The dev server: a recipe links could name is the endpoint's. */
	dev: boolean;
}

function unmet(needs: readonly Need[], cannot: readonly Need[]): Need | undefined {
	return needs.find((n) => cannot.includes(n));
}

function code_of(code: LinkCode, link: LinkPlan): Links<LinkPlan> {
	return code[link.kind] as Links<LinkPlan>;
}

/** The namer of `plan`, with the link `code` of each platform it names. */
export function namer(plan: NamerPlan, code: LinkCode): Namer {
	return (recipe) => {
		const needs = needs_of(recipe);
		let first: string | undefined;
		for (const link of plan.links) {
			const missing = unmet(needs, link.cannot) ?? code_of(code, link).unmet(recipe, link);
			if (missing === undefined) return plan.dev ? null : code_of(code, link).link(recipe, link);
			first ??= missing;
		}
		if (plan.endpoint !== null && unmet(needs, plan.endpoint) === undefined) return null;
		throw new RenderError('image_encoder_cannot', {
			encoder: plan.encoders,
			need:
				(plan.endpoint === null ? first : unmet(needs, plan.endpoint)) ?? first ?? needs.join(', ')
		});
	};
}
