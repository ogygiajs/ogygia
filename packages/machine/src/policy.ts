/**
 * How work that fails is tried again, named once: how many tries, how long to wait between them,
 * how much to spread those waits, and when to stop trying at all.
 *
 *   const peer = policy({ attempts: 4, backoff: [200, 1000, 5000], jitter: 0.2, deadline: 30_000 });
 *
 * A policy is plain data (frozen), checked when it is made, so a wrong number fails where it is
 * written, not on the first failure in production. Name it for what it protects (`peer`, `store`,
 * `sink`): its numbers are then tuned in one place, with their reason beside them. The outbox and
 * `flights({ retry })` run their tries under one (`under_policy`); work with tries of its own (a
 * machine's `retrying` state) reads its waits from one (`backoffAfter`).
 */
import { clock } from './clock.ts';
import { machine_error } from './messages.ts';
import { MAX_TIMEOUT_MS, scope, type Scope } from './scope.ts';
import { STALE, type Stale } from './stale.ts';

export interface Policy {
	/** Tries in all, the first one included: a whole number of 1 or more. */
	readonly attempts: number;
	/** The wait before each try after the first, in ms: a list (the wait before the second try,
	 *  the third, …; its last one repeats), or one number that doubles with each try. */
	readonly backoff: number | readonly number[];
	/** 0 to 1: each wait is cut by up to this share of it, at random, so many senders that failed
	 *  together do not all try again at the same moment. */
	readonly jitter: number;
	/** The most time all the tries may take, in ms from the first: a try still out then is aborted,
	 *  and none starts after it. `Infinity` for no limit. */
	readonly deadline: number;
}

function bad(option: string, value: unknown, rule: string): Error {
	return machine_error('machine_bad_option', {
		option: `policy ${option}`,
		value: Array.isArray(value) ? `[${value.join(', ')}]` : String(value),
		rule
	});
}

const is_wait = (ms: unknown): boolean => typeof ms === 'number' && ms >= 0 && ms <= MAX_TIMEOUT_MS;

function make_policy(p: Partial<Policy> = {}): Policy {
	const attempts = p.attempts ?? STANDARD.attempts;
	if (!Number.isInteger(attempts) || attempts < 1)
		throw bad('attempts', attempts, 'a whole number of 1 or more');
	const backoff = p.backoff ?? STANDARD.backoff;
	if (Array.isArray(backoff) ? backoff.length === 0 || !backoff.every(is_wait) : !is_wait(backoff))
		throw bad('backoff', backoff, 'a wait of 0 to 2147483647 ms, or a list of them');
	const jitter = p.jitter ?? STANDARD.jitter;
	if (!(typeof jitter === 'number' && jitter >= 0 && jitter <= 1))
		throw bad('jitter', jitter, 'a share of 0 to 1');
	const deadline = p.deadline ?? STANDARD.deadline;
	if (
		!(typeof deadline === 'number' && deadline > 0 && (deadline === Infinity || is_wait(deadline)))
	)
		throw bad('deadline', deadline, 'a time of more than 0 ms, or Infinity');
	return Object.freeze({
		attempts,
		backoff: Array.isArray(backoff) ? Object.freeze([...backoff]) : backoff,
		jitter,
		deadline
	});
}

/** The standard policy: 4 tries, after 0.2 s, 1 s and 5 s, each wait spread by up to a fifth, all
 *  within 30 s. Long enough to ride out a restart or a brief outage of the other side, short enough
 *  to fit the time a serverless platform keeps a request alive after its response. */
const STANDARD: Policy = Object.freeze({
	attempts: 4,
	backoff: Object.freeze([200, 1000, 5000]),
	jitter: 0.2,
	deadline: 30_000
});

/** A retry policy, checked and frozen; what it leaves out is the standard one's. `policy.standard`
 *  is that one. */
export const policy: { (p?: Partial<Policy>): Policy; readonly standard: Policy } =
	/* @__PURE__ */ Object.assign(make_policy, { standard: STANDARD });

/** The wait before try `n + 1`, once try `n` (1 for the first; 0 counts as 1) failed: a number of
 *  0 to the timer limit, however many tries. `random` is 0 to 1. */
export function backoffAfter(p: Policy, n: number, random: number = Math.random()): number {
	const b = p.backoff;
	const tries = Math.max(1, n);
	// (0 doubles to 0 forever: never 0 * 2^n, which is NaN once 2^n is Infinity)
	const base =
		typeof b === 'number' ? (b === 0 ? 0 : b * 2 ** (tries - 1)) : b[Math.min(tries, b.length) - 1];
	return Math.min(MAX_TIMEOUT_MS, Math.round(base * (1 - p.jitter * random)));
}

/** What tries that ran out of time failed with: the deadline, and the last try's own error. */
export function out_of_time(deadline: number, error: unknown): DOMException {
	return new DOMException(
		`no try was done within ${deadline} ms${error === undefined ? '' : ` (last: ${String(error)})`}`,
		'TimeoutError'
	);
}

/**
 * A timer of the tries that keeps a Node process alive, unlike a scope's own: the work between two
 * tries is still work out, as a try in flight is (whose socket holds the process). Without it a
 * process with nothing else to do exits in the wait, and the send is neither done nor given up.
 */
function alive(tries: Scope, fn: () => void, ms: number): void {
	const timer = setTimeout(fn, ms);
	tries.defer(() => clearTimeout(timer));
}

/**
 * Runs `work` under `p`: its answer once a try gives one; after a try fails, the next one after the
 * policy's wait (at once when it is 0: no timer, the same turn of the loop); the last try's error
 * once the tries run out, or a `TimeoutError` (`out_of_time`) once the deadline passes, which also
 * aborts the try out. `signal` (the caller's) ends it early: the try out is aborted and it answers
 * `STALE`. Each try's signal aborts with either.
 */
export async function under_policy<T>(
	p: Policy,
	work: (signal: AbortSignal) => T,
	signal?: AbortSignal
): Promise<Awaited<T> | Stale> {
	if (signal?.aborted) return STALE;
	const tries = scope();
	let left = false;
	if (signal !== undefined) tries.on(signal, 'abort', () => ((left = true), tries.close()));
	const started = p.deadline === Infinity ? 0 : clock.mono();
	if (p.deadline !== Infinity) alive(tries, () => tries.close(), p.deadline);
	let error: unknown = undefined;
	try {
		for (let n = 1; ; n++) {
			try {
				const answer = await tries.task(work);
				if (!tries.closed) return answer as Awaited<T>;
			} catch (e) {
				error = e;
			}
			if (left) return STALE;
			if (tries.closed) throw out_of_time(p.deadline, error);
			if (n >= p.attempts) throw error;
			const wait = backoffAfter(p, n);
			// (a wait that ends past the deadline is a try that would only be aborted: out of time)
			if (p.deadline !== Infinity && clock.mono() - started + wait >= p.deadline)
				throw out_of_time(p.deadline, error);
			if (wait > 0) {
				await tries.task(() => new Promise<void>((r) => alive(tries, r, wait)));
				if (left) return STALE;
				if (tries.closed) throw out_of_time(p.deadline, error);
			}
		}
	} finally {
		tries.close();
	}
}
