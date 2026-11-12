// A BATCH CALLED OFF WHILE ITS BODY COMES (runtime/frame-nav.ts `streamFrames`). A navigation the
// visitor leaves for another one ends its visit, and the visit calls its batch off: the browser
// fails the body's pending read with an AbortError. The batch ends quietly: nothing it started is
// left to reject with nobody listening (found by the simulator: palaestra seed 24 with crowds, two
// links clicked 60 ms apart).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scope } from '@ogygia/machine';
import { streamFrames } from '../../src/runtime/frame-nav.ts';
import { _reset } from '../_frames.ts';
import { build_parcel } from '../../src/server/stream-regions.ts';

const ep = (sig: string) => `/__ogygia__?id=cccccccccccc&props=${sig}&exp=9999999999&sig=${sig}`;

/** A batch answer that sends `first`, then waits; called off, its body fails as a browser's does. */
function called_off_after(first: string) {
	vi.spyOn(window, 'fetch').mockImplementation(
		async (_url, init) =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(first));
						const signal = init?.signal;
						signal?.addEventListener('abort', () => controller.error(signal.reason), {
							once: true
						});
					}
				}),
				{ status: 200, headers: { 'content-type': 'text/html' } }
			)
	);
}

afterEach(() => {
	vi.restoreAllMocks();
	_reset();
});

describe('a batch called off while its body comes', () => {
	it('ends quietly: its promise settles, and no rejection goes unheard', async () => {
		called_off_after(build_parcel('s1', '<p>one</p>'));
		const unheard: unknown[] = [];
		const hear = (e: PromiseRejectionEvent) => unheard.push(e.reason);
		window.addEventListener('unhandledrejection', hear);
		try {
			const visit = scope();
			const batch = streamFrames([ep('s1'), ep('s2')], 'nav', visit).then(
				() => 'settled',
				(err: { name?: string }) => `rejected ${err?.name}`
			);
			await new Promise((r) => setTimeout(r, 50));
			// the visitor went elsewhere: the visit ends, and its batch with it
			visit.close();
			expect(await batch).toBe('settled');
			await new Promise((r) => setTimeout(r, 50));
			expect(unheard).toEqual([]);
		} finally {
			window.removeEventListener('unhandledrejection', hear);
		}
	});

	it('a body that breaks off midway ends the batch quietly too, like a request that fails', async () => {
		vi.spyOn(window, 'fetch').mockImplementation(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(build_parcel('s1', '<p>one</p>')));
							setTimeout(() => controller.error(new TypeError('network error')), 20);
						}
					}),
					{ status: 200, headers: { 'content-type': 'text/html' } }
				)
		);
		const visit = scope();
		const batch = streamFrames([ep('s1'), ep('s2')], 'nav', visit).then(
			() => 'settled',
			(err: { name?: string }) => `rejected ${err?.name}`
		);
		expect(await batch).toBe('settled');
		visit.close();
	});
});
