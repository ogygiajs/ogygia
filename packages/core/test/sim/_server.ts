// The server's rules (src/server/rules.ts, #313) as a simulated run's rule: whatever else a run
// checks, it must end with none of them broken.
import type { Sim } from '@ogygia/config/sim';
import { install_server_rules, server_rules } from '../../src/server/rules.ts';

install_server_rules();

/** The run ends with every server rule kept. */
export function server_rules_hold(sim: Sim): void {
	sim.finally('server rules', () => {
		const broken = server_rules.broken();
		return broken.length === 0 ? null : broken.map((b) => `${b.code}: ${b.detail}`).join('; ');
	});
}

/**
 * Runs of a primitive's simulation (flights, the outbox, scopes): 1000 in node. The browser run
 * (test/browser/sim-primitives.test.ts) adds the engine's own promise order, AbortSignal and
 * EventTarget, and each run ends on real timer tasks (Firefox waits 4 ms or more for each nested
 * one): 1000 took 13 s there, past the 15 s timeout on a loaded runner. 200 there, same seed.
 */
export const PRIMITIVE_RUNS: number = typeof document === 'undefined' ? 1000 : 200;
