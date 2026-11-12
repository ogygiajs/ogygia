import { kit_render_context } from './kit-context.ts';
import { nested_context } from '../nested.ts';

/**
 * The context the endpoint renders a hole's answer in: Kit's request context, and, for a hole that
 * wakes (its capability's signed `w`), marked inside an island, the context its hydrate gets
 * (`nested_context`, runtime/hydrate-core.ts). The regions inside then take the same branch on both
 * sides (#906, test/woken-hole-capability.test.ts).
 */
export function hole_answer_context(wakes: boolean): Map<unknown, unknown> {
	const base: Map<unknown, unknown> = kit_render_context();
	return wakes ? nested_context(base) : base;
}
