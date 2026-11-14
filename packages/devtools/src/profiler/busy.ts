/**
 * Waiting for a busy profiler. A worker records one profile at a time (the V8 profiler is
 * process-wide): one that is recording answers `/page` with a 409. There is no queue on the server
 * (a serverless worker is recycled within ~30 s), so the queue lives with the caller: ask again
 * until a worker takes it. On serverless the next ask lands on a free worker; on one server it is
 * taken once the profile ahead ends. Both the dock's tabs and the run page wait this one way.
 */
import { clock, policy, STALE, type Policy, type Scope, type Stale } from '@ogygia/machine';

/** How a profile waits for a busy profiler: asked again every 2 s (or when the 409's
 *  `Retry-After` says), for up to 2 min; a profile ahead longer than that is a stuck one (Reset). */
const PROFILER_BUSY: Policy = policy({
	attempts: 61,
	backoff: 2000,
	jitter: 0,
	deadline: 120_000
});

/** The wait before the next ask, after a 409: its `Retry-After` (seconds), else the policy's; never
 *  past what is left of the deadline (`left` ms), so no header asks for a wait no timer takes
 *  (test/devtools-profile-busy.test.ts). */
function busy_wait(res: Response, left: number): number {
	const after = Number(res.headers.get('retry-after')) * 1000;
	const wait = Number.isFinite(after) && after > 0 ? after : (PROFILER_BUSY.backoff as number);
	return Math.max(0, Math.min(wait, left));
}

/** What a caller shows while it waits: each ask as it starts, each wait for a busy worker (with
 *  the time waited so far). */
export interface BusyWatch {
	asking?: () => void;
	busy?: (waited_ms: number) => void;
}

/**
 * `fetch(url)` until the answer is not a 409, or the wait runs out (the last 409 is the answer: the
 * caller says so). `owner` owns the asks and the waits: once it ends, the request is aborted,
 * nothing more is asked, and the answer is `STALE`.
 */
export async function fetch_when_free(
	owner: Scope,
	url: string,
	init: RequestInit = {},
	{ asking, busy }: BusyWatch = {}
): Promise<Response | Stale> {
	const started = clock.mono();
	for (let n = 1; ; n++) {
		asking?.();
		const res = await owner.task((signal) => fetch(url, { ...init, signal }));
		if (res === STALE || res.status !== 409) return res;
		const waited = clock.mono() - started;
		if (n >= PROFILER_BUSY.attempts || waited > PROFILER_BUSY.deadline) return res;
		busy?.(waited);
		const wait = busy_wait(res, PROFILER_BUSY.deadline - waited);
		// oxlint-disable-next-line ogygia/no-silent-failures -- only the status and the header are read
		void res.body?.cancel().catch(() => {});
		const slept = await owner.task(() => new Promise<void>((r) => owner.timeout(r, wait)));
		if (slept === STALE) return STALE;
	}
}
