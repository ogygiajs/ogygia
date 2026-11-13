import { kit_render_context, kit_request_event } from './kit-context.ts';
import { nested_context } from '../nested.ts';
import { HOLE_SLOT_SEQUENCE, hole_slot_sequence } from '../region-snippet.ts';
import { document_counts } from './document-counts.ts';

/**
 * The context the endpoint renders a hole's answer in: Kit's request context, the hole's own slot
 * sequence (its ids carry its region id, in a batch as in its own GET), and, for a hole that wakes
 * (its capability's signed `w`), marked inside an island, the context its hydrate gets
 * (`nested_context`, runtime/hydrate-core.ts). The regions inside then take the same branch on both
 * sides (#906, test/woken-hole-capability.test.ts).
 *
 * The hole's sequence is also the request's, unless an earlier hole of the same batch set it: a render
 * root the hole starts (`await region(…)`, a held region) makes its context fresh, so it counts on the
 * request's sequence, and that one must never be the page's unprefixed one
 * (test/batch-hole-slot-prefix.test.ts).
 */
export function hole_answer_context(wakes: boolean, region_id: string): Map<unknown, unknown> {
	const base: Map<unknown, unknown> = kit_render_context();
	let seq = hole_slot_sequence(region_id);
	const counts = document_counts(kit_request_event());
	if (counts) {
		// (one sequence per prefix in the request: one region twice in a batch, or two whose ids
		// begin alike, count on together and never mint the same id)
		const holes = (counts.holes ??= new Map());
		seq = holes.get(seq.prefix) ?? seq;
		holes.set(seq.prefix, seq);
		counts.slots ??= seq;
	}
	base.set(HOLE_SLOT_SEQUENCE, seq);
	return wakes ? nested_context(base) : base;
}
