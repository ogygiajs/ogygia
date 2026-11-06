/**
 * PUSHABLE PROPS: the props a mounted island reads reactively, so the next value reaches it in
 * place instead of a re-hydrate — a live region's next tick, a kept island's next page. The island
 * is hydrated with `props` itself (Svelte's documented reactive-props form for `hydrate`), so
 * focus and local state survive and Svelte reconciles the view. Filled into the `pushable` slot by
 * the live feature (./live.ts); a page with neither live nor kept regions never loads it.
 */
export type PushableProps = {
	props: Record<string, unknown>;
	push: (next: Record<string, unknown>) => void;
};

export function pushable_props(initial: Record<string, unknown>): PushableProps {
	const props = $state(initial);
	return {
		props,
		push(next) {
			for (const key of Object.keys(props)) if (!(key in next)) delete props[key];
			Object.assign(props, next);
		}
	};
}
