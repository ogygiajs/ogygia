// A BATCH STREAM THAT STOPS SENDING (runtime/frame-nav.ts `streamFrames`). A navigation or a page's
// holes reserve their addresses and join one streamed response; each joined hole waits for its part.
// A stream that sends one part and then goes quiet (a proxy holding the connection, a server stuck on
// one render) must not hold the others on their fallback forever: once it has been quiet long enough
// their reservations fail, and each hole fetches on its own.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observe } from '@ogygia/machine';
import { streamFrames } from '../../src/runtime/frame-nav.ts';
import { _reset, ensure } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';
import { build_parcel } from '../../src/server/stream-regions.ts';

const ep = (sig: string) => `/__ogygia__?id=bbbbbbbbbbbb&props=${sig}&exp=9999999999&sig=${sig}`;

/** A batch answer that sends `first` and then nothing, ever (the connection stays open). */
function stall_after(first: string) {
	vi.spyOn(window, 'fetch').mockImplementation(
		async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(first));
					}
				}),
				{ status: 200, headers: { 'content-type': 'text/html' } }
			)
	);
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	_reset();
});

describe('a stalled batch stream', () => {
	it('sends one frame and stalls: the hole it carried has it, the others fail and fetch on their own', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		stall_after(build_parcel('s1', '<p>one</p>'));
		const own = vi.fn(async () => 'own');
		void streamFrames([ep('s1'), ep('s2')]);
		// (both reserved at once: their fetches join the stream)
		const carried = ensure(frameAddress(ep('s1')), own);
		let outcome = 'waiting';
		void ensure(frameAddress(ep('s2')), own).then(
			() => (outcome = 'answered'),
			(err: { name?: string }) => (outcome = err?.name ?? 'failed')
		);
		expect(await carried).toBe('<p>one</p>');
		// a slow part is not cut short: a few quiet seconds are a server still rendering
		await vi.advanceTimersByTimeAsync(5_000);
		expect(outcome).toBe('waiting');
		// quiet for long: the stream is given up, and the hole it never carried is let go
		await vi.advanceTimersByTimeAsync(10_000);
		expect(outcome, 'the stalled stream let the waiting hole go').toBe('OgygiaBatchMiss');
		expect(own).not.toHaveBeenCalled();
	});

	it('an answer that never starts: the stream is given up while sending, and its holes are let go', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let aborted = false;
		vi.spyOn(window, 'fetch').mockImplementation(
			(_url, init) =>
				new Promise<Response>((_, reject) =>
					init?.signal?.addEventListener('abort', () => {
						aborted = true;
						reject(new DOMException('aborted', 'AbortError'));
					})
				)
		);
		const steps: string[] = [];
		const off = observe((name, from, to) => {
			if (name === 'batch-stream') steps.push(`${from?.kind} -> ${to?.kind}`);
		});
		const own = vi.fn(async () => 'own');
		try {
			void streamFrames([ep('s1'), ep('s2')]);
			const outcomes = [ep('s1'), ep('s2')].map((e) =>
				ensure(frameAddress(e), own).then(
					() => 'answered',
					(err: { name?: string }) => err?.name ?? 'failed'
				)
			);
			// a few quiet seconds are a server still rendering
			await vi.advanceTimersByTimeAsync(5_000);
			expect(aborted).toBe(false);
			await vi.advanceTimersByTimeAsync(10_000);
			expect(await Promise.all(outcomes)).toEqual(['OgygiaBatchMiss', 'OgygiaBatchMiss']);
		} finally {
			off();
		}
		expect(steps).toContain('sending -> stalled');
		expect(aborted, 'the request is aborted').toBe(true);
		expect(own).not.toHaveBeenCalled();
	});
});
