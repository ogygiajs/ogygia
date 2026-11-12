/**
 * What measuring costs the page's main thread, by phase (ms): the time the devtools and the
 * profiler's beacon spend only because someone measures, so a CPU comparison can leave it out.
 *
 * @packageDocumentation
 */
import { clock } from '@ogygia/machine';

// @why the runtime and devtools chunks each carry a copy (test: test/own-cost.test.ts › two copies of the module (the runtime and the devtools chunks) keep one ledger)
const spent: Record<string, number> = ((globalThis as Record<symbol, Record<string, number>>)[
	Symbol.for('ogygia.own-cost')
] ??= {});

/** Add the time since `t0` to `phase`. */
export function charge(phase: string, t0: number): void {
	spent[phase] = (spent[phase] ?? 0) + (clock.mono() - t0);
}

/** Run `fn`, charging its time to `phase`. */
export function metered<T>(phase: string, fn: () => T): T {
	const t0 = clock.mono();
	try {
		return fn();
	} finally {
		charge(phase, t0);
	}
}

/** The cost so far, rounded: `{ ms, phases }`. */
export function own_cost(): { ms: number; phases: Record<string, number> } {
	const phases: Record<string, number> = {};
	let ms = 0;
	for (const k in spent) {
		phases[k] = Math.round(spent[k] * 10) / 10;
		ms += spent[k];
	}
	return { ms: Math.round(ms * 10) / 10, phases };
}
