/**
 * Remote-seeds feature: seed the reused Kit client query cache from the server's
 * `application/ogygia-remote` side-channel (zero-flash hydration), and clear it across SPA swaps.
 *
 * A HYDRATE-phase feature (link/runtime-entry.ts): installed by the hydrate core, never the boot —
 * only the hydrate core (and the navigation's seeds.ts) reads the slot, and the decoder imports the
 * APP's transport codecs (its own `src/hooks.ts`), which reach Svelte. Installed only in an app that
 * has a remote function at all.
 */
import { boot_link, slots } from './slots.ts';
import { seed_query_responses } from '../shims/kit-remote/client-stub.ts';
import { clear_remote_seeds, release_remote_instances } from '../shims/kit-remote/remote-cache.ts';

const REMOTE_SEED_SELECTOR = 'script[type="application/ogygia-remote"]';

// Flicker fix: seed the reused Kit client query cache from the server's side-channel script
// (emitted by `ogygiaHandle` on csr=false pages) exactly ONCE per document, before any island's
// reused `Query` constructor reads `query_responses`. Cleared on SPA body swap.
function seed_once(): void {
	const session = boot_link().runtime_session;
	if (session.remote_seeded) return;
	session.mark_remote_seeded();
	if (typeof document === 'undefined') return;
	const text = document.querySelector(REMOTE_SEED_SELECTOR)?.textContent;
	if (text) seed_query_responses(text);
}

/** Feature entry: fill the `remoteSeeds` slot. */
export function install(): void {
	slots.remoteSeeds = {
		seed_once,
		seed_query_responses,
		clear_remote_seeds,
		release_remote_instances
	};
}
