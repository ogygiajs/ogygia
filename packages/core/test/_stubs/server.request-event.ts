// Test stub for `ogygia:server/request-event` (real one resolves to `$app/server` on SSR and a
// throwing stub on the client). By default it is Kit's own `getRequestEvent()`, the function
// `$app/server` re-exports: a test that runs inside Kit's request store (`with_request_store`, the
// plugin harness's `inRequest`) reads that request, and outside one it throws, as in an app. A suite
// that needs a request without the store (a csr=true document — `documentIsCsrTrue()` reads the
// request's route id) installs its own reader with `set_request_event_stub` and clears it after.
import { getRequestEvent as kit_get_request_event } from '@sveltejs/kit/internal/server';

const kit = (): unknown => kit_get_request_event();

export let getRequestEvent: () => unknown = kit;

/** Install (or with `null` clear) the request-event reader the library sees. */
export function set_request_event_stub(fn: (() => unknown) | null): void {
	getRequestEvent = fn ?? kit;
}
