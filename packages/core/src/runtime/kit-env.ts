/**
 * KIT'S PUBLIC ENV ON A PAGE KIT NEVER STARTS (KIT-PUBLIC-ENV). Kit's browser `$app/env/public`
 * reads its dynamic public variables from Kit's boot payload, which only Kit's client boot fills.
 * On a csr=false page that boot never runs, so the compiler makes the module read this instead
 * (compiler kit-patches.ts): the env the server rendered for the page, written as the
 * `application/ogygia-env` side channel (server/env-seed.ts `env_seed_script`) with the build that
 * wrote it. Only Kit's patched module imports it, so a page whose islands never import Kit's env
 * never loads it. Kit's module runs as soon as a region's module runs, which can be before any lazy
 * chunk took the boot's link, so it finds the channel on its own, by the mark of the document's head
 * runtime script (RESPONSE-MARK), and imports nothing of the runtime's. A prerendered page carries no
 * value: it asks for the deployed server's, which Kit serves as `_app/env.js`, and the runtime holds
 * its regions' code until that is in (kit-env-first.ts, {@link serve_kit_env}). An island the runtime runs
 * before its page is the open one (a region the server renders later, a remote answer's, a router
 * prefetch's) reads an empty env and says `kit_env_missing` (#2219), and so does a region of another
 * build (a federated peer's, #2221).
 *
 * @packageDocumentation
 */
import { parse } from 'devalue';

/** The side channel the server writes the env into. */
export const KIT_ENV_SELECTOR = 'script[type="application/ogygia-env"]';
// oxlint-disable-next-line ogygia/markup-from-vocabulary -- the head runtime script, spelled here: wire-markup.ts is a boot module, which this lazy chunk must not import; test/browser/kit-env-unlinked.test.ts holds the spelling to OGYGIA_RUNTIME
export const KIT_ENV_RUNTIME_SELECTOR = 'script[data-ogygia-runtime]';
// oxlint-disable-next-line ogygia/markup-from-vocabulary -- the attribute of a response's mark, as above; the test holds it to RESPONSE_MARK
export const KIT_ENV_MARK_ATTR = 'data-og-mark';

/** The server's ask, on a prerendered page, for the deployed server's env (`KIT_ENV_SERVED_TYPE`,
 *  spelled again: a lazy chunk imports no module of the boot's). */
export const KIT_ENV_SERVED_SELECTOR = 'script[type="application/ogygia-env-served"]';

type Missing = 'absent' | 'unreadable' | 'other-build' | 'unserved';

function missing(why: Missing, cause?: unknown): Record<string, unknown> {
	// oxlint-disable-next-line ogygia/no-silent-failures -- a warning whose own chunk did not load is lost: the env still reads empty, and Kit's module still evaluates
	void import('../messages/lazy.ts').then(
		({ warn }) => warn('kit_env_missing', { why }, cause),
		() => {}
	);
	return {};
}

/** The env channel bearing `doc`'s mark, or null: RESPONSE-MARK's `server_channel`, spelled again
 *  with no import of the runtime's. */
export function env_channel(doc: Document, selector: string = KIT_ENV_SELECTOR): Element | null {
	const mark = doc.head?.querySelector(KIT_ENV_RUNTIME_SELECTOR)?.getAttribute(KIT_ENV_MARK_ATTR);
	if (!mark) return null;
	for (const el of doc.querySelectorAll(selector))
		if (el.getAttribute(KIT_ENV_MARK_ATTR) === mark) return el;
	return null;
}

const is_record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';

/** Where Kit serves an app's `env.js`, as the build knows it: Kit's resolved `paths.base` and
 *  `paths.assets`, and its app dir. */
export interface KitEnvAt {
	readonly base: string;
	readonly app_dir: string;
	readonly assets: string;
}

/**
 * The app's `env.js`, beside the `immutable` folder `module_url` (this chunk) was served from, so an
 * app whose files moved to another folder finds it as Kit's relative paths do. The app's own origin
 * only: with assets on another host, or a chunk served from elsewhere, it is under `paths.base`.
 */
export function kit_env_url(at: KitEnvAt, module_url: string, origin: string): string {
	if (at.assets === '' && module_url.startsWith(`${origin}/`)) {
		const end = module_url.indexOf(`/${at.app_dir}/immutable/`);
		if (end !== -1) return `${module_url.slice(0, end)}/${at.app_dir}/env.js`;
	}
	return `${origin}${at.base}/${at.app_dir}/env.js`;
}

let served: Record<string, unknown> | null = null;

/** Loads Kit's `env.js` with `load` and keeps its env for {@link kit_env}: what the runtime waits
 *  for before a prerendered page's regions (runtime/kit-env-first.ts). Rejects when it did not load
 *  or holds no env. */
export async function serve_kit_env(
	at: KitEnvAt,
	load: (url: string) => Promise<unknown>
): Promise<void> {
	const module = await load(kit_env_url(at, import.meta.url, location.origin));
	if (!is_record(module) || !is_record(module.env)) throw new Error('env.js exports no env');
	served = module.env;
}

/** The public env the server sent this document, as Kit would have put it in its payload, when
 *  `build` wrote it; else the env Kit's `env.js` served (a prerendered page's). An empty env, said
 *  with `kit_env_missing`, where the document carries none, it does not read back, another build
 *  wrote it, or a prerendered page's did not load. */
export function kit_env(build: string): Record<string, unknown> {
	const el = typeof document === 'undefined' ? null : env_channel(document);
	if (el === null) {
		if (served !== null) return served;
		const asked =
			typeof document !== 'undefined' && env_channel(document, KIT_ENV_SERVED_SELECTOR) !== null;
		return missing(asked ? 'unserved' : 'absent');
	}
	let sent: unknown;
	try {
		sent = parse(el.textContent ?? '');
	} catch (e) {
		return missing('unreadable', e);
	}
	if (!is_record(sent) || !is_record(sent.env)) return missing('unreadable');
	if (sent.build !== build) return missing('other-build');
	return sent.env;
}
