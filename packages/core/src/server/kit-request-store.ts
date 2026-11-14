import type { RequestState } from '@sveltejs/kit/internal/server';
import { try_get_request_store, with_request_store } from '@sveltejs/kit/internal/server';

export type { RequestState };

/**
 * KIT'S PRIVATE REQUEST STORE: the one module that imports it (#1724; a lint rule refuses the
 * import anywhere else). Kit's public `getRequestEvent()` (`$app/server`) hands over the event, and
 * every event read goes through it (server/live-event.ts); the app's `transport` comes from its own
 * hooks file (`ogygia:region`). It does not hand over the remote queries Kit resolved during a
 * csr=false render (`state.remote`), nor run code inside a request without Kit's Vite plugin (the
 * plugin test harness). Those reads stay here; test/canary/kit-request-store.test.ts pins them
 * against every Kit the workspace installs.
 */
export class KitRequestStore {
	/** The live request's Kit state, or null outside a request. */
	static state(): RequestState | null {
		return try_get_request_store()?.state ?? null;
	}

	/** The live request's event where `$app/server` does not resolve (a plugin's own unit tests run
	 *  `app.keepAlive` without Kit's Vite plugin), or null outside a request. */
	static event(): unknown {
		return try_get_request_store()?.event ?? null;
	}

	/** Runs `fn` inside a request carrying `event`, as Kit runs a hook: the event is there through
	 *  every await of it. */
	static run<T>(event: unknown, fn: () => T): T {
		return with_request_store({ event, state: {} as RequestState }, fn);
	}
}
