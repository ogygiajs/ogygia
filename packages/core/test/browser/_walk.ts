// A hand-written component for the hydrate tests: it claims server nodes the way a compiled one
// walks past them (Svelte checks the walk ended at the island's closing anchor).
// @ts-expect-error -- svelte ships no types for its internal client entry
import { next } from 'svelte/internal/client';
import type { Component } from 'svelte';

/** A component that runs `run`, then claims the next `n` server nodes. */
export function claims(
	n: number,
	run: () => void = () => {}
): {
	default: Component<Record<string, unknown>>;
} {
	return {
		default: (() => {
			run();
			if (n) (next as (count: number) => void)(n);
		}) as unknown as Component<Record<string, unknown>>
	};
}
