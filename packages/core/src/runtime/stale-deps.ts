import { clock, flights, net, storage } from '@ogygia/machine';
import { code_url } from './code-origins.ts';

const STALE_DEP_RELOAD_KEY = 'ogygia:dev:dep-reload';
const STALE_DEP_RELOAD_WINDOW_MS = 6000;

type Ask = { url: string; reload: () => void };

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

// @why a Vite dep re-optimization rotates its browserHash, and Vite's full reload does not always reach a csr=false tab, which then imports `?v=<old>` dep URLs that 404 (test: test/browser/stale-deps.test.ts › two islands that fail to import together reload the tab once)
/** An island's entry failed to import: confirm at `url` (its module URL) that the entry still
 *  serves, then `reload` the tab. */
export async function recover_from_stale_deps(
	url: string,
	reload: () => void = () => location.reload()
): Promise<void> {
	if (!import.meta.env.DEV || typeof location === 'undefined') return;
	const code = code_url(url);
	if (code === null) return;
	await (watch ??= make_watch()).get({ url: code, reload });
}

async function confirm_and_reload(url: string, reload: () => void): Promise<void> {
	try {
		const session = storage.session();
		if (session === null) return;
		const last = Number(session.getItem(STALE_DEP_RELOAD_KEY) || 0);
		if (clock.wall() - last < STALE_DEP_RELOAD_WINDOW_MS) return;
		const res = await net.fetch(url, { cache: 'no-store' });
		if (!res.ok) return;
		session.setItem(STALE_DEP_RELOAD_KEY, String(clock.wall()));
		reload();
	} catch {
		// ok: dev only: storage or fetch blocked; the error said before this stays, and the dev reloads by hand
	}
}
