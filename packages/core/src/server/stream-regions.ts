import { machine, type Scope } from '@ogygia/machine';
import { OG_LEN, OGYGIA_SLOT } from '../wire-markup.ts';

const STREAM_DONE_SLOT = '__ogygia_done__';

function has_template_close(html: string): boolean {
	// markup-ok: a false yes only frames the answer by length, which is always safe
	for (let i = html.indexOf('</'); i !== -1; i = html.indexOf('</', i + 2)) {
		if (html.length - i < 10) return false;
		if (html.slice(i + 2, i + 10).toLowerCase() === 'template') return true;
	}
	return false;
}

/**
 * Build a parcel `<template data-ogygia-slot="…">…rendered html…</template>` for the batch endpoint,
 * keyed by the call's capability signature. The client reads a parcel as TEXT
 * (runtime/frame-nav.ts), never as DOM, and a plain one ends at the first `</template>`: an answer
 * that carries a `</template` of its own (any case; a web component's declarative shadow root) is
 * LENGTH-FRAMED instead, `data-og-len` being its UTF-16 length (the unit the client's decoded string
 * counts in), so its content can never close the box or forge a parcel for another slot.
 */
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

type BatchStates = { streaming: {}; ended: {}; cancelled: {} };
const batch_steps = { streaming: ['ended', 'cancelled'], ended: [], cancelled: [] } as const;
const batch_def = machine<BatchStates>()({
	name: 'batch stream',
	initial: 'streaming',
	steps: batch_steps
});

/**
 * The batch's frame stream: every call renders at once, and each answer goes out as its parcel the
 * moment it settles, whatever the order; the done sentinel ends it. A call `render` leaves out (null)
 * or that fails writes no parcel: the client fetches it on its own. `render` is handed the batch's
 * signal: it aborts when the stream is cancelled (the visitor left), or when `owner` (the request's)
 * ends first, so a call still waiting for a render slot leaves the queue and never renders (#245); a
 * parcel that lands after that is dropped, never written to the closed stream.
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
			await batch.scope.task((signal) =>
				Promise.all(
					calls.map(async (endpoint) => {
						const out = await render(endpoint, signal).catch(() => null); // ok: the render says its own failure; the hole keeps its fallback and fetches itself
						if (out && batch.now === streaming)
							controller.enqueue(encoder.encode(build_parcel(out.slot, out.html)));
					})
				)
			);
			if (!batch.move('streaming', 'ended')) return;
			controller.enqueue(encoder.encode(done_parcel()));
			controller.close();
		},
		cancel() {
			batch.move('streaming', 'cancelled');
		}
	});
}
