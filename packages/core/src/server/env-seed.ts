/**
 * KIT-PUBLIC-ENV, the server's half: the page seed's sibling for Kit's public env, written by the
 * handle (a Kit page) and by `document()` (a router page) on its own ask, under no feature's bit, only where
 * a region on the page asked for it (its client code imports Kit's `$app/env/public`). The browser's
 * half is runtime/kit-env.ts.
 *
 * @packageDocumentation
 */
import { building } from '$app/env';
import { kit_env_build, kit_public_env } from 'ogygia:server';
import { KIT_ENV_SERVED_TYPE } from '../kit-env-served.ts';
import { RESPONSE_MARK } from '../contract/response-mark.ts';
import { warn } from '../messages/server.ts';
import { devalue_text } from './devalue-text.ts';
import { ogygia_script } from './document-assembly.ts';
import { response_mark } from './response-mark.ts';

type Made =
	| { kind: 'unmade' }
	| { kind: 'made'; build: string; from: Map<string, unknown>; text: string | null };

class EnvText {
	#made: Made = { kind: 'unmade' };

	of(build: string, env: Record<string, unknown>): string | null {
		const made = this.#made;
		if (made.kind === 'made' && made.build === build && same(made.from, env)) return made.text;
		const from = new Map(Object.entries(env));
		let text: string | null = null;
		if (from.size > 0) {
			try {
				text = devalue_text({ build, env }, {});
			} catch (e) {
				warn('kit_env_unshipped', { reason: e instanceof Error ? e.message : String(e) });
			}
		}
		this.#made = { kind: 'made', build, from, text };
		return text;
	}
}

function same(from: ReadonlyMap<string, unknown>, env: Record<string, unknown>): boolean {
	let n = 0;
	for (const k in env) {
		if (!Object.hasOwn(env, k)) continue;
		if (!from.has(k) || !Object.is(from.get(k), env[k])) return false;
		n++;
	}
	return n === from.size;
}
const ENV_TEXT = new EnvText();

/**
 * Kit's public env as one `<script type="application/ogygia-env">`, marked with `request`'s mark:
 * exactly what Kit puts in its boot payload on a csr=true page (Kit 3's `rendered_env`, public
 * variables only), serialized with devalue as Kit does, beside the build that wrote it
 * (`kit_env_build()`, the identity the build's browser reader is bound to), so a region of another
 * build (a federated peer's) never reads it as its own. A page written while the app builds
 * (prerendered) carries no value, only the marked ask for the deployed server's
 * (`application/ogygia-env-served`, runtime/kit-env-first.ts), as Kit's own prerendered page loads
 * `_app/env.js`. Null: this Kit has none, it holds no variable (the identity is then never asked),
 * or it does not serialize (said with `kit_env_unshipped`).
 */
export function env_seed_script(request: Request): string | null {
	const env = kit_public_env();
	if (env === null || Object.keys(env).length === 0) return null;
	const mark = `${RESPONSE_MARK}="${response_mark(request)}"`;
	if (building) return `<script type="${KIT_ENV_SERVED_TYPE}" ${mark}></script>`;
	const text = ENV_TEXT.of(kit_env_build(), env);
	if (text === null) return null;
	return ogygia_script('env', text, mark);
}
