/**
 * KIT'S PUBLIC ENV ON A PAGE KIT NEVER STARTS (KIT-PUBLIC-ENV). Kit's browser `$app/env/public`
 * reads its dynamic public variables from Kit's boot payload, which only Kit's client boot fills.
 * On a csr=false page that boot never runs, so the compiler makes the module read this instead
 * (compiler kit-patches.ts): the env the server rendered for the page, written as the
 * `application/ogygia-env` side channel (server/env-seed.ts `env_seed_script`) with the build that
 * wrote it. Only Kit's patched module imports it, so a page whose islands never import Kit's env
 * never loads it. Kit's module runs as soon as a region's module runs, which can be before any lazy
 * chunk took the boot's link, so it finds the channel on its own, by the mark of the document's head
 * runtime script (RESPONSE-MARK), and imports nothing of the runtime's. An island the runtime runs
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

type Missing = 'absent' | 'unreadable' | 'other-build';

function missing(why: Missing, cause?: unknown): Record<string, unknown> {
	// oxlint-disable-next-line ogygia/no-silent-failures -- a warning whose own chunk did not load is lost: the env still reads empty, and Kit's module still evaluates
	void import('../messages/lazy.ts').then(
		({ warn }) => warn('kit_env_missing', { why }, cause),
		() => {}
	);
	return {};
}

function channel(doc: Document): Element | null {
	const mark = doc.head?.querySelector(KIT_ENV_RUNTIME_SELECTOR)?.getAttribute(KIT_ENV_MARK_ATTR);
	if (!mark) return null;
	for (const el of doc.querySelectorAll(KIT_ENV_SELECTOR))
		if (el.getAttribute(KIT_ENV_MARK_ATTR) === mark) return el;
	return null;
}

const is_record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';

/** The public env the server sent this document, as Kit would have put it in its payload, when
 *  `build` wrote it. An empty env, said with `kit_env_missing`, where the document carries none, it
 *  does not read back, or another build wrote it. */
export function kit_env(build: string): Record<string, unknown> {
	const el = typeof document === 'undefined' ? null : channel(document);
	if (el === null) return missing('absent');
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
