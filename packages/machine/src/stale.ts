/** What async work gives back when its owner moved on before the answer arrived: a machine left the
 *  visit, a scope closed, a flight was dropped or its caller left. */
export const STALE: unique symbol = Symbol.for('ogygia.machine.stale');
export type Stale = typeof STALE;

/**
 * What a wait gives once it is not `STALE`: `T` with `Stale` taken out, and out of each slot of an
 * array or tuple (the `Promise.all` shape). One level deep, as the wait checks: an object keeps its
 * `Stale` fields.
 *
 *   const both = await s.task(() => Promise.all([load(), pages.get(href)]));
 *   if (both === STALE) return;
 *   const [mod, page] = both; // neither is Stale
 */
export type Fresh<T> = T extends Stale
	? never
	: T extends readonly unknown[]
		? { [K in keyof T]: Exclude<T[K], Stale> }
		: T;

/**
 * A wait's value, whole: `STALE` when it is `STALE`, or an array with `STALE` among its items (if
 * anything it waited on is stale, the whole wait is). Every wait of the package hands its value
 * through here. One level deep: objects and nested arrays are not scanned.
 */
export function whole<T>(value: T): Fresh<T> | Stale {
	if (Array.isArray(value))
		for (let i = 0; i < value.length; i++) if (value[i] === STALE) return STALE;
	return value as Fresh<T>;
}
