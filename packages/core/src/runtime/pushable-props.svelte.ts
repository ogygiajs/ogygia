/**
 * PUSHABLE PROPS: the props a mounted island reads reactively, so the next value reaches it in
 * place instead of a re-hydrate — a live region's next tick, a kept island's next page. The island
 * is hydrated with `props` itself (Svelte's documented reactive-props form for `hydrate`), so
 * focus and local state survive and Svelte reconciles the view. Filled into the `pushable` slot by
 * the live feature (./live.ts); a page with neither live nor kept regions never loads it.
 *
 * The props are a snapshot of data, as every island's are: held RAW (`$state.raw`), never deep-proxied
 * — the island reads the very values pushed (a large nav tree pays no proxy on each read, identity
 * holds, `structuredClone` works), and mutating one is no more reactive than in any other island. A
 * push replaces the whole snapshot; `props` is a plain reader over the current one, so each prop read
 * tracks it.
 */
export class PushableProps {
	#current: Record<string, unknown> = $state.raw({});
	/** What the island is hydrated with: the current snapshot's props, read live. */
	readonly props: Record<string, unknown>;

	constructor(initial: Record<string, unknown>) {
		this.#current = initial;
		this.props = new Proxy({} as Record<string, unknown>, {
			get: (_, key) => (typeof key === 'string' ? this.#current[key] : undefined),
			has: (_, key) => key in this.#current,
			ownKeys: () => Reflect.ownKeys(this.#current),
			getOwnPropertyDescriptor: (_, key) =>
				key in this.#current
					? { enumerable: true, configurable: true, value: this.#current[key as string] }
					: undefined
		});
	}

	/** The next snapshot (a live tick, the next page's props): replaces the current one whole. */
	push(next: Record<string, unknown>): void {
		this.#current = next;
	}
}
