// A peer's island entry built by an older ogygia: its own hydrate takes no `pushable` option, so it
// hands back no push. Loaded from another origin, it is a foreign entry.
import type { Component } from 'svelte';
import { og_entry_hydrate, og_entry_unmount } from '../../../src/entry-hydrate.ts';
import Label from './Label.svelte';

const g = globalThis as { __og_old_peer_hydrates?: number };

export default Label;
export function __og_hydrate(
	target: Element,
	props: Record<string, unknown>,
	options?: { recover?: boolean; context?: Map<string | symbol, unknown> }
): unknown {
	g.__og_old_peer_hydrates = (g.__og_old_peer_hydrates ?? 0) + 1;
	const { recover, context } = options ?? {};
	return og_entry_hydrate(Label as unknown as Component<Record<string, unknown>>, target, props, {
		recover,
		context
	});
}
export { og_entry_unmount as __og_unmount };
