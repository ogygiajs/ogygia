/**
 * `beforeNavigate` / `afterNavigate` as a component sees them (`$app/navigation`, `ogygia/app`):
 * bound to the calling component's lifetime, like Kit's. It imports Svelte, so island code reaches
 * it through the shims, never the runtime's boot (test/runtime-boot-svelte-free.test.ts).
 *
 * @packageDocumentation
 */
import { onDestroy } from 'svelte';

/**
 * Tie a registration's unsubscribe to the calling component's lifetime: it is called when the
 * component is destroyed, so an island mounted on every visit leaves none behind. Outside a
 * component the registration stands and the unsubscribe is the caller's. Returns it either way.
 */
export function bind_to_component(off: () => void): () => void {
	try {
		onDestroy(off);
	} catch {
		// ok: not inside a component; the caller owns the unsubscribe it was handed
	}
	return off;
}
