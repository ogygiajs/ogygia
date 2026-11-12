/**
 * DEV watchdog for a stranded tab (dev only; the branch is dead in a production build). Under
 * `csr = false` Kit ships no client bootstrap, so a Vite dep re-optimization — which rotates the
 * optimizer's browserHash — can leave a tab that was loaded under the old hash importing island dep
 * URLs (`svelte.js?v=<old>`) that now 404, and Vite's own full-reload does not always reach a
 * csr=false page. The island entry then throws `Failed to fetch dynamically imported module` on
 * wake, and nothing recovers it.
 *
 * We CONFIRM it is staleness, not a genuinely-missing module: re-fetch the entry URL, and reload
 * only when the server still serves it (200) — a real 404 is a different bug and must stay visible.
 * A timestamp in `sessionStorage` bounds it to one reload per few seconds, so a genuinely broken
 * entry (200 that keeps failing to import) never loops.
 */
import { flights } from '@ogygia/machine';
import { code_url } from './code-origins.ts';

const STALE_DEP_RELOAD_KEY = 'ogygia:dev:dep-reload';
const STALE_DEP_RELOAD_WINDOW_MS = 6000;

type Ask = { url: string; reload: () => void };

/** One watch per page: the islands that fail together (a stale tab fails them all) join the first
 *  one's confirm, so the guard is read and written by one run, and the tab reloads once
 *  (test/browser/stale-deps.test.ts). After it, the guard in `sessionStorage` answers. Made on first
 *  use: a production build never reaches it, and keeps none of it. */
const make_watch = () =>
	flights.keyed<Ask>()({
		name: 'stale-dep reload',
		key: [],
		ignore: {
			url: 'one reload loads every island: the first failing entry is the one confirmed',
			reload: 'one tab to reload'
		},
		keep: 0,
		run: ({ url, reload }) => confirm_and_reload(url, reload)
	});
let watch: ReturnType<typeof make_watch> | undefined;

/** An island's entry failed to import: confirm at `url` (its module URL) that the entry still
 *  serves, then `reload` the tab. */
export async function recover_from_stale_deps(
	url: string,
	reload: () => void = () => location.reload()
): Promise<void> {
	if (!import.meta.env.DEV || typeof location === 'undefined') return;
	// (code the page refused to load is not asked for here either: ./code-origins.ts)
	const code = code_url(url);
	if (code === null) return;
	await (watch ??= make_watch()).get({ url: code, reload });
}

async function confirm_and_reload(url: string, reload: () => void): Promise<void> {
	try {
		const last = Number(sessionStorage.getItem(STALE_DEP_RELOAD_KEY) || 0);
		// wall: the last reload's time lives in sessionStorage, across page loads
		if (Date.now() - last < STALE_DEP_RELOAD_WINDOW_MS) return; // already reloaded — don't loop
		const res = await fetch(url, { cache: 'no-store' });
		if (!res.ok) return; // a real 404 — leave the error visible, it is not a re-optimize
		sessionStorage.setItem(STALE_DEP_RELOAD_KEY, String(Date.now())); // wall: read by the next page load
		reload();
	} catch {
		// ok: dev only: storage or fetch blocked; the error said before this stays, and the dev reloads by hand
	}
}
