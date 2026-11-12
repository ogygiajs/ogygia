/**
 * A response's mark: random per response, written by the handle on the head runtime script and on
 * every side channel it writes into the document (the page seed, the remote seed, the page context
 * root, the holes record, the devtools events). The runtime reads a channel only when it bears the
 * mark its document's head runtime script bears, so a script of the same type that page markup
 * carries is never the server's (INVARIANTS RESPONSE-MARK, test/browser/side-channel-seeds.test.ts).
 * Internal markup, not an app-facing format.
 */

/** The attribute a response's mark is written in. */
export const RESPONSE_MARK = 'data-og-mark';
