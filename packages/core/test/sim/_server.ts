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
