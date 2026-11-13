/**
 * A REGION REQUEST, in order (PROBE-THEN-RENDER, internal/notes/INVARIANTS.md): a hole's GET, its
 * renewal, and each hole of a batch POST walk the same steps:
 *
 *   received → prechecked → probed → verified → charged → rendering → sent
 *       ╲──────────────────────╲────────────────────╲──────────╲──→ refused
 *
 * Each move is taken before its work, so a refusal leaves the state whose work refused it; no work
 * runs in `prechecked` or `verified`, so neither refuses (test/machine-steps.test.ts).
 *
 * `prechecked`: shape, expiry and key passed, before any HMAC. `probed`: the visitor's probe budget
 * charged (forged floods stop here). `verified`: the capability's signature checked (or, for a
 * renewal, the original's, then re-signed). `charged`: the render budget charged. Only then
 * `rendering`. Rendering, or charging the render budget, before the capability verifies is an
 * illegal move (a thrown `machine_illegal_move` in dev and tests; refused in production), not a
 * convention (`packages/core/test/region-request-order.test.ts`).
 */
import { machine, type Definition, type Machine } from '@ogygia/machine';

type States = {
	received: {};
	prechecked: {};
	probed: {};
	verified: {};
	charged: {};
	rendering: {};
	sent: {};
	refused: {};
};

const STEPS = {
	received: ['prechecked', 'refused'],
	prechecked: ['probed'],
	probed: ['verified', 'refused'],
	verified: ['charged'],
	charged: ['rendering', 'refused'],
	rendering: ['sent', 'refused'],
	sent: [],
	refused: []
} as const;

export const region_request: Definition<States, typeof STEPS, 'received'> = machine<States>()({
	name: 'region request',
	initial: 'received',
	steps: STEPS
});

export type RegionRequest = Machine<States, typeof STEPS>;
