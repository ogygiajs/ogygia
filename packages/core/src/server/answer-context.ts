import { kit_render_context } from './kit-context.ts';
import { nested_context } from '../nested.ts';
import { HOLE_SLOT_SEQUENCE, hole_slot_sequence } from '../region-snippet.ts';

/**
 * The context the endpoint renders a hole's answer in: Kit's request context, the hole's own slot
 * sequence (its ids carry its region id, in a batch as in its own GET), and, for a hole that wakes
 * (its capability's signed `w`), marked inside an island, the context its hydrate gets
 * (`nested_context`, runtime/hydrate-core.ts). The regions inside then take the same branch on both
 * sides (#906, test/woken-hole-capability.test.ts).
 */
export function hole_answer_context(wakes: boolean, region_id: string): Map<unknown, unknown> {
	const base: Map<unknown, unknown> = kit_render_context();
	base.set(HOLE_SLOT_SEQUENCE, hole_slot_sequence(region_id));
	return wakes ? nested_context(base) : base;
}
