/** A Svelte 5 SSR hydration marker's comment data: a block opens with `[` (`<!--[-->`, a branch
 *  `<!--[0-->` / `<!--[-1-->`, an each's fallback `<!--[!-->`), Svelte's private `HYDRATION_START`.
 *  test/canary/svelte-hydration-markers.test.ts pins every marker here against the installed
 *  Svelte (#1715). */
export const BLOCK_OPEN = '[';

/** The comment data that closes a block (`<!--]-->`), Svelte's `HYDRATION_END`. */
export const BLOCK_CLOSE = ']';

/** The open of an `{#if}`'s first branch (`<!--[0-->`): Svelte's server render of a whole component
 *  in one branch, the envelope a region's markup can arrive in. */
export const FIRST_BRANCH_OPEN = '[0';

/** An empty anchor (`<!---->`): a `{@render}`, a `{#key}`, and the one at the top level of
 *  `<head>` that follows a `<svelte:head>` block's hash comment. */
export const ANCHOR = '';
