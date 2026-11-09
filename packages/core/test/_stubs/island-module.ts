/**
 * An island entry's module, as a stand-in for the bench runs: a component that reads its props, the
 * way a compiled island's first line does. With test/_stubs/svelte-hydrate.ts it is the island's whole
 * hydrate: nothing of Svelte's walk.
 */
export default function Island(_target: unknown, props: Record<string, unknown>): number {
	return Object.keys(props).length;
}
