// The frame store, for tests that write and fetch HTML of their own: a test's markup stands in for an
// answer the sink vouched for (runtime/html-sink.ts), so these take plain strings.
import type { Frame } from '../src/frame.ts';
import * as store from '../src/runtime/frame-store.ts';
import type { VerifiedHtml } from '../src/runtime/html-sink.ts';

export {
	_reset,
	BATCH_MISS,
	hold_refusal,
	is_idle,
	peek,
	release,
	renew,
	renewal,
	reserve,
	subscribe,
	ticket
} from '../src/runtime/frame-store.ts';

export const write = (f: Frame): boolean => store.write(f as store.StoredFrame);

export const ensure = (
	a: string,
	fetcher: (signal: AbortSignal) => Promise<string>,
	opts?: Parameters<typeof store.ensure>[2]
): ReturnType<typeof store.ensure> =>
	store.ensure(a, fetcher as (signal: AbortSignal) => Promise<VerifiedHtml>, opts);
