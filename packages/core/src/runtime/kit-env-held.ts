/**
 * KIT-PUBLIC-ENV: the env the server sent with an answer the runtime read, held for Kit's patched
 * `$app/env/public` (./kit-env.ts `kit_env`). That module reads the env once, as it first runs, from
 * whatever document is open, and the runtime can run it before the page that carries the env is the
 * open one: a prefetch warms the next page's islands (router-nav.ts `warm_modules`, from that page's
 * own marked channel), and an island inside a region answer (a server hole, a region a remote call
 * renders) runs on a page that asked for no env (core.ts `region_fragment`). Kit's public env is the
 * server's, not a page's, so the last one held is the env. A leaf: the router, the hydrate core and
 * the env reader share it, and it imports nothing.
 *
 * @packageDocumentation
 */

/** The type of the env's side channel, in a document and in a region answer. */
export const KIT_ENV_TYPE = 'application/ogygia-env';
/** The env's side channel, as a selector. */
export const KIT_ENV_SELECTOR: `script[type="${typeof KIT_ENV_TYPE}"]` = `script[type="${KIT_ENV_TYPE}"]`;

class HeldKitEnv {
	#text: string | null = null;

	hold(text: string): void {
		this.#text = text;
	}

	text(): string | null {
		return this.#text;
	}
}

/** The env text of the answers the runtime read. */
export const HELD_KIT_ENV: HeldKitEnv = new HeldKitEnv();
