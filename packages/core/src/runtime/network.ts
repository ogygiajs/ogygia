/**
 * THE NETWORK, NOT THE SERVER (#891). A request that failed while the browser says it is offline
 * failed for the network: asking again on a timer only spends the tries, and giving up keeps a
 * fallback after the network is back. Such a failure waits for the `online` event instead (a hole's
 * fetch, an island's code: core.ts). An answer the server gave (an error status, a refusal) is no
 * network failure, and gives up as before.
 */

/** The browser says it has no network (`navigator.onLine` is false). */
export function browser_offline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** A request that got no response: `fetch` rejects with a TypeError (an abort is a DOMException,
 *  an error status an Error of the caller's own). */
export function no_response(err: unknown): boolean {
	return err instanceof TypeError;
}
