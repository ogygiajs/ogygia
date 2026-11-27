/**
 * KIT'S PUBLIC ENV ON A PAGE KIT NEVER STARTS (KIT-PUBLIC-ENV). Kit's browser `$app/env/public`
 * reads its dynamic public variables from Kit's boot payload, which only Kit's client boot fills.
 * On a csr=false page that boot never runs, so the compiler makes the module read this instead
 * (compiler kit-patches.ts): the env the server rendered for the page, written as the
 * `application/ogygia-env` side channel (server/env-seed.ts `env_seed_script`), or, where the open
 * document carries none, the env of the answer that brought the island (./kit-env-held.ts). Only
 * Kit's patched module imports it, so a page whose islands never import Kit's env never loads it. It
 * reads the channel through the boot's link, as every lazy chunk does (messages/lazy.ts).
 *
 * @packageDocumentation
 */
import { parse } from 'devalue';
import { boot_link_or_null } from './lazy-link.ts';
import { L_SERVER_CHANNEL } from './boot-link-index.ts';
import { HELD_KIT_ENV, KIT_ENV_SELECTOR } from './kit-env-held.ts';
import { warn } from '../messages/lazy.ts';

/** The public env the server sent this document, as Kit would have put it in its payload: the open
 *  document's channel, else the env held from the answer that brought the island. An empty env,
 *  said with `kit_env_missing`, where there is none or it does not read back. */
export function kit_env(): Record<string, unknown> {
	const read =
		typeof document === 'undefined' ? undefined : boot_link_or_null()?.[L_SERVER_CHANNEL];
	const text = (read ? read(document, KIT_ENV_SELECTOR)?.textContent : null) ?? HELD_KIT_ENV.text();
	if (text !== null) {
		try {
			const env = parse(text);
			if (env !== null && typeof env === 'object') return env as Record<string, unknown>;
		} catch (e) {
			warn('kit_env_missing', { why: 'unreadable' }, e);
			return {};
		}
	}
	warn('kit_env_missing', { why: text !== null ? 'unreadable' : 'absent' });
	return {};
}
