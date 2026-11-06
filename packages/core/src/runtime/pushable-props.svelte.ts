/**
 * PUSHABLE PROPS: the props a mounted island reads reactively, so the next value reaches it in
 * place instead of a re-hydrate — a live region's next tick, a kept island's next page. The island
 * is hydrated with `props` itself (Svelte's documented reactive-props form for `hydrate`), so
 * focus and local state survive and Svelte reconciles the view. Filled into the `pushable` slot by
 * the live feature (./live.ts); a page with neither live nor kept regions never loads it.
 *
 * The props are a snapshot of data, as every island's are: held RAW (`$state.raw`), never deep-proxied
 * — the island reads the very values pushed (a large nav tree pays no proxy on each read, identity
 * holds), and mutating one is no more reactive than in any other island. A push replaces the whole
 * snapshot; `props` is a plain reader over the current one, so each prop read tracks it.
 */
export type PushableProps = {
	props: Record<string, unknown>;
	push: (next: Record<string, unknown>) => void;
};

export function pushable_props(initial: Record<string, unknown>): PushableProps {
	let current = $state.raw(initial);
	const props = new Proxy({} as Record<string, unknown>, {
		get: (_, key) => (typeof key === 'string' ? current[key] : undefined),
		has: (_, key) => key in current,
		ownKeys: () => Reflect.ownKeys(current),
		getOwnPropertyDescriptor: (_, key) =>
			key in current
				? { enumerable: true, configurable: true, value: current[key as string] }
				: undefined
	});
	return {
		props,
		push(next) {
			current = next;
		}
	};
}
