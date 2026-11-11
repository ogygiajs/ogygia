/**
 * Region parcels for the batch endpoint (single-flight navigation, a page's first-load holes, OOO).
 * Each rendered region call is boxed as a `<template data-ogygia-slot>` parcel keyed by its capability
 * signature; the client frame stream reads them out of order and drops each into the matching region.
 * A done-sentinel ends the batch.
 *
 * The client reads a parcel as TEXT (runtime/frame-nav.ts), never as DOM. A plain parcel ends at the
 * first `</template>`; an answer that itself carries `</template` (a web component's declarative
 * shadow root) is LENGTH-FRAMED instead — `data-og-len` is its UTF-16 length, the unit the client's
 * decoded string counts in — so its content can never close the box or forge a parcel for another
 * slot, and it no longer falls back to a second request.
 *
 * No I/O and no Kit (the batch stream is handed its render), so it stays unit-testable.
 */
import { machine, STALE, type Scope } from '@ogygia/machine';
import { OG_LEN, OGYGIA_SLOT } from '../wire-markup.ts';

/** Sentinel slot appended once a batch finishes, so waiting regions know it is complete. */
const STREAM_DONE_SLOT = '__ogygia_done__';

/** Does `html` carry a `</template` (any case) — one that would close a plain parcel early? */
function has_template_close(html: string): boolean {
	for (let i = html.indexOf('</'); i !== -1; i = html.indexOf('</', i + 2)) {
		if (html.length - i < 10) return false;
		if (html.slice(i + 2, i + 10).toLowerCase() === 'template') return true;
	}
	return false;
}

/** Build a parcel `<template data-ogygia-slot="…">…rendered html…</template>` (length-framed when
 *  the html carries a `</template` of its own). */
export function build_parcel(slot: string, html: string): string {
	if (has_template_close(html))
		return `<template ${OGYGIA_SLOT}="${slot}" ${OG_LEN}="${html.length}">${html}</template>`;
	return `<template ${OGYGIA_SLOT}="${slot}">${html}</template>`;
}

/** The done-sentinel parcel (empty template) the client watches to end the batch. */
export function done_parcel(): string {
	return `<template ${OGYGIA_SLOT}="${STREAM_DONE_SLOT}"></template>`;
}

/** One region call's answer in a batch: its slot (the capability signature) and its HTML. Null:
 *  the call is left out (the client fetches it on its own). */
export type BatchAnswer = { slot: string; html: string } | null;

/**
 * A batch's stream, as a machine: streaming while its calls render, then ended (the done sentinel
 * written) or cancelled (the visitor left: the response body was cancelled). The renders are the
 * streaming visit's work, so a cancel aborts their signal (a call still waiting for a render slot
 * leaves the queue and never renders, #245), and a parcel that lands after it is dropped, never
 * written to a closed stream.
 */
type BatchStates = { streaming: {}; ended: {}; cancelled: {} };
const batch_steps = { streaming: ['ended', 'cancelled'], ended: [], cancelled: [] } as const;
const batch_def = machine<BatchStates>()({
	name: 'batch stream',
	initial: 'streaming',
	steps: batch_steps
});

/**
 * The batch's frame stream: every call renders at once, and each answer goes out as its parcel the
 * moment it settles, whatever the order; the done sentinel ends it. `render` is handed the batch's
 * signal: it aborts when the stream is cancelled, or when `owner` (the request's) ends first.
 */
export function batch_stream(
	calls: readonly string[],
	render: (endpoint: string, signal: AbortSignal) => Promise<BatchAnswer>,
	owner?: Scope
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const batch = batch_def.create();
	owner?.defer(() => {
		batch.move('streaming', 'cancelled');
	});
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const streaming = batch.now;
			// Each call renders independently; enqueue its frame on settle, whatever the order.
			const ran = await batch.scope.task((signal) =>
				Promise.all(
					calls.map(async (endpoint) => {
						const out = await render(endpoint, signal).catch(() => null); // ok: the render says its own failure; the hole keeps its fallback and fetches itself
						// (only while it still streams: after a cancel the controller is closed)
						if (out && batch.now === streaming)
							controller.enqueue(encoder.encode(build_parcel(out.slot, out.html)));
					})
				)
			);
			if (ran === STALE || !batch.move('streaming', 'ended')) return;
			controller.enqueue(encoder.encode(done_parcel()));
			controller.close();
		},
		cancel() {
			batch.move('streaming', 'cancelled');
		}
	});
}
