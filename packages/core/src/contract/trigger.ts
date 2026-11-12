/**
 * THE TRIGGER VOCABULARY (#482): when a region wakes, fetches, prefetches or revalidates is a
 * keyword (`load`, `idle`, `visible`, and for a wake or a swap `interaction`) or a media query.
 * It is parsed here once into a tagged union, by the compiler's checks and the runtime alike, and a
 * schedule is interpreted in one place (`on_schedule`).
 */

/** A parsed trigger. */
export type Trigger =
	| { readonly on: 'load' }
	| { readonly on: 'idle' }
	| { readonly on: 'visible' }
	| { readonly on: 'interaction' }
	| { readonly on: 'media'; readonly query: string };

export type TriggerKeyword = Exclude<Trigger['on'], 'media'>;

/** A schedule's keywords: a fetch, a prefetch, a revalidation (never `interaction`, a gesture). */
export const SCHEDULE: readonly TriggerKeyword[] = ['load', 'idle', 'visible'];
/** A wake's (and a hole's swap's) keywords: a schedule's, and `interaction`. */
export const WAKE: readonly TriggerKeyword[] = ['load', 'idle', 'visible', 'interaction'];

/** True if `value` looks like a CSS media query (a `(` with a `)` after it). */
export function is_media_query(value: string): boolean {
	const open = value.indexOf('(');
	return open !== -1 && value.indexOf(')', open) !== -1;
}

/** `value` as a trigger, when it is a keyword `allow` holds or a media query; else `null`. */
export function parse_trigger(value: string, allow: readonly TriggerKeyword[]): Trigger | null {
	if ((allow as readonly string[]).includes(value)) return { on: value as TriggerKeyword };
	if (is_media_query(value)) return { on: 'media', query: value };
	return null;
}

/** How a schedule is armed: on idle, on screen, on a media query (a load runs at once). */
export interface ScheduleArms {
	idle(fire: () => void): void;
	visible(fire: () => void): void;
	media(query: string, fire: () => void): void;
}

/**
 * Runs `fire` on the schedule `when` names. A value no schedule takes (`interaction`, which a hole
 * fetched on a gesture carries into its cached lake) runs on load: a revalidation must not wait on
 * a media query that never matches.
 */
export function on_schedule(when: string, arms: ScheduleArms, fire: () => void): void {
	const t = parse_trigger(when, SCHEDULE) ?? { on: 'load' };
	if (t.on === 'idle') arms.idle(fire);
	else if (t.on === 'visible') arms.visible(fire);
	else if (t.on === 'media') arms.media(t.query, fire);
	else fire();
}
