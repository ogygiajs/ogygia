/**
 * EVERY RETRY, BACKOFF AND DEADLINE OF THE RUNTIME AND THE SERVER, NAMED ONCE (#313). Each is a
 * `policy()` of `@ogygia/machine` named for what it protects, with the reason for its numbers
 * beside it: the work that tries again reads them from here, never a number of its own.
 *
 * These are the numbers the code used before they were named (no behavior moved with them), so
 * tuning one is a change here and nowhere else. Each is marked pure: a bundle keeps only the ones
 * its code reads (the browser runtime does not ship the server's render and stream deadlines).
 */
import { policy, type Policy } from '@ogygia/machine';

/** A lazy chunk of the runtime (the hydrate core, the navigation chunk, devalue): one more try at
 *  once when its download fails, under a fresh URL (`import_again`). A dropped download is usually
 *  a blip; a second failure is a real outage, and the caller's own recovery takes over. */
export const download: Policy = /* @__PURE__ */ policy({
	attempts: 2,
	backoff: 0,
	jitter: 0,
	deadline: Infinity
});

/** devalue's download for a read that runs once (a streamed value's resolver): asked for again
 *  after 1, 2, 4 and 8 s, then left (the network is down; the reads wait, as before). */
export const devalue_download: Policy = /* @__PURE__ */ policy({
	attempts: 5,
	backoff: 1000,
	jitter: 0,
	deadline: Infinity
});

/** A hole's fetch of its region: three tries, 0.5 s then 1 s apart, before it keeps its fallback.
 *  Long enough for a server restart's blip, short enough that a broken hole settles fast. */
export const region_fetch: Policy = /* @__PURE__ */ policy({
	attempts: 3,
	backoff: [500, 1000],
	jitter: 0,
	deadline: Infinity
});

/** A hole refused for its server, not its request (`sig`, `shape`, `foreign-key`: the answering
 *  server checks capabilities of another build or key, #1752): asked once more after 0.5 s, since a
 *  rolling deploy's load balancer may route the second ask to a server of the page's own build. */
export const region_other_build: Policy = /* @__PURE__ */ policy({
	attempts: 2,
	backoff: [500],
	jitter: 0,
	deadline: Infinity
});

/** A hole the endpoint rate-limited (a 429, #959): its tries are `region_fetch`'s, and the wait
 *  before each is what the 429's `Retry-After` says (the visitor's window), at most this backoff: a
 *  window longer than a minute (a misconfigured or hostile answer) never parks a hole for good. A
 *  429 with no `Retry-After` waits `region_fetch`'s own backoff. */
export const region_rate_limited: Policy = /* @__PURE__ */ policy({
	attempts: 3,
	backoff: [60_000],
	jitter: 0,
	deadline: Infinity
});

/** A region's server render, its wait for a render slot included: one try within 10 s (#195). A
 *  render stuck on a hung upstream past it is abandoned, so it never holds a slot for good. */
export const render: Policy = /* @__PURE__ */ policy({
	attempts: 1,
	backoff: 0,
	jitter: 0,
	deadline: 10_000
});

/** A batch stream of holes: given up after 10 s with no bytes (#214). The server sends a hole's part
 *  only once it has rendered, so a few quiet seconds are a slow render, not a dead stream; the
 *  `render` deadline bounds each render, so a stream quiet for as long is dead. */
export const stream: Policy = /* @__PURE__ */ policy({
	attempts: 1,
	backoff: 0,
	jitter: 0,
	deadline: 10_000
});

/** An island file's recovery during a deploy's rollover: the current build's map asked at once,
 *  then after 1, 3 and 9 s while it settles (a rollover settles in seconds). */
export const rollover: Policy = /* @__PURE__ */ policy({
	attempts: 4,
	backoff: [1000, 3000, 9000],
	jitter: 0,
	deadline: Infinity
});
