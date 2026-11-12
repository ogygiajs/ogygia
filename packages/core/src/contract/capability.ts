/** What the build's option check and the server's capability renewal agree on. */

/** The default for how long after expiry a capability can still be renewed
 *  (`maxPageAge`): the longest a stale document is expected to live in a shared cache (a
 *  week of `s-maxage` plus a day of revalidation). */
export const RENEW_WINDOW_SEC: number = 8 * 24 * 3600;
