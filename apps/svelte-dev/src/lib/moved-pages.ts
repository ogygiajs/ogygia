/**
 * Pages upstream moved or folded into another, by topic: the old leaf → the leaf that holds its
 * content now. The same moves svelte.dev redirects (its `hooks.server.js`), so a link the corpus
 * still carries to the old address (a type's doc comment shown in a code hover) lands on the page.
 * Consulted only when no page has the old leaf: a corpus that still has it serves it.
 */
const MOVED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	// Kit 3: the options live on the Vite plugin, documented with `@sveltejs/kit/vite`
	kit: { configuration: '@sveltejs-kit-vite' }
};

/** The leaf `leaf` moved to within `topic`, or null when it did not move. */
export function moved_leaf(topic: string, leaf: string): string | null {
	return Object.hasOwn(MOVED, topic) && Object.hasOwn(MOVED[topic]!, leaf)
		? MOVED[topic]![leaf]!
		: null;
}

/** Every move, as `[topic, old leaf]` pairs (the redirect stubs to prerender). */
export function moved_leaves(): Array<[string, string]> {
	return Object.entries(MOVED).flatMap(([topic, leaves]) =>
		Object.keys(leaves).map((leaf): [string, string] => [topic, leaf])
	);
}
