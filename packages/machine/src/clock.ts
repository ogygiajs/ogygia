/**
 * The two clocks (#472):
 *
 * - `clock.mono()`: milliseconds on the monotonic clock, for every duration inside one process (a
 *   TTL, a deadline, a time budget, a wait). It never steps: an NTP correction, a VM resume or a
 *   laptop waking moves the wall clock, not this one. Its zero is the process's (or the page's)
 *   start, so a reading means nothing outside this process.
 * - `clock.wall()`: milliseconds since the epoch, for a timestamp that leaves the process (a log
 *   line, a header, a stored date) or is compared with one that came from outside.
 *
 * Both read the platform's clocks when called, so a simulated run that drives them drives these.
 */
export const clock = {
	mono: (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
	wall: (): number => Date.now()
} as const;
