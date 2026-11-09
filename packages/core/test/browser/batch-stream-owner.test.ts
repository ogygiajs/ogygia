// A BATCH STREAM IS ITS PAGE'S (runtime/frame-nav.ts `streamFrames`). The holes of a page go out
// as one streamed request, and the request is the page visit's (runtime/session.ts `PageVisit`):
// when the visitor leaves the page, it stops. And every way a batch ends lets go of its answer's
// body, the end mark the server sends included, not only a stall.
import { afterEach, expect, test, vi } from 'vitest';
import { streamFrames } from '../../src/runtime/frame-nav.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { build_parcel } from '../../src/server/stream-regions.ts';

const ep = (sig: string) => `/__ogygia__?id=bbbbbbbbbbbb&props=${sig}&exp=9999999999&sig=${sig}`;

/** A batch answer that sends `first` and keeps its connection open; what became of it. */
function answer_then_hold(first: string) {
	const seen = { cancelled: false, aborted: false };
	vi.spyOn(window, 'fetch').mockImplementation(async (_input, init) => {
		init?.signal?.addEventListener('abort', () => (seen.aborted = true), { once: true });
		return new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(first));
				},
				cancel() {
					seen.cancelled = true;
				}
			}),
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	});
	return seen;
}

afterEach(() => {
	vi.restoreAllMocks();
	_reset();
});

test('a batch that ends on the server’s end mark lets go of the answer’s body', async () => {
	const seen = answer_then_hold(build_parcel('__ogygia_done__', ''));
	await streamFrames([ep('d1'), ep('d2')], 'page');
	expect(seen.cancelled).toBe(true);
});

test('the batch of a page’s holes stops when the visitor leaves the page', async () => {
	const seen = answer_then_hold(build_parcel('p1', '<p>one</p>'));
	let ended = false;
	void streamFrames([ep('p1'), ep('p2')], 'page').then(() => (ended = true));
	await new Promise((r) => setTimeout(r, 50));
	expect(ended).toBe(false); // still waiting for the second hole's part
	// the next page's swap takes over: the page's visit ends
	runtime_session.reset();
	await expect.poll(() => ended, { timeout: 1_000 }).toBe(true);
	expect(seen.aborted || seen.cancelled).toBe(true);
});
