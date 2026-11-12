import { observe, type AnyMachine } from './machine.ts';
import { DISPOSE } from './scope.ts';

/** How many lines a trace keeps by default. */
const DEFAULT_MAX = 500;

/** Options for {@link trace}. */
export interface TraceOptions {
	/** The most lines it keeps; past it, the oldest go first. Default 500. */
	max?: number;
	/** Records only the machines whose name this accepts. */
	only?: (name: string) => boolean;
}

/** A running trace: see {@link trace}. */
export interface Trace extends Disposable {
	/** The moves so far, oldest first, one line each. */
	lines(): string[];
	/** The lines joined, after a first line saying how many older ones were let go (if any). */
	text(): string;
	/** Forgets the lines so far; numbering goes on. */
	clear(): void;
	/** Stops listening. The lines stay readable. */
	stop(): void;
}

/**
 * Records every machine move as one short line, for a test to print when it fails. Built on
 * {@link observe}, so it costs nothing until a trace starts, and one check per move while it runs.
 *
 * ```ts
 * const moves = trace();
 * // …the test drives the page…
 * moves.text();
 * // hole#1 idle -> loading
 * // visit#3 loading -> answered
 * // visit#3 answered -> stopped
 * ```
 *
 * Each machine is numbered per name in the order it first moves (`visit#1`, `visit#2`), so two
 * visits in one log stay apart. The log keeps the last `max` lines and says how many it let go.
 */
export function trace(options: TraceOptions = {}): Trace {
	const max = Math.max(1, options.max ?? DEFAULT_MAX);
	const only = options.only;
	const ids = new WeakMap<AnyMachine, number>();
	const counts: Record<string, number> = Object.create(null);
	let lines: string[] = [];
	let dropped = 0;
	const unwatch = observe((name, from, to, machine) => {
		if (only && !only(name)) return;
		let id = ids.get(machine);
		if (id === undefined) {
			id = (counts[name] ?? 0) + 1;
			counts[name] = id;
			ids.set(machine, id);
		}
		lines.push(`${name}#${id} ${from.kind} -> ${to ? to.kind : 'stopped'}`);
		if (lines.length > max) {
			lines.shift();
			dropped++;
		}
	});
	let listening = true;
	const stop = () => {
		if (!listening) return;
		listening = false;
		unwatch();
	};
	return {
		lines: () => [...lines],
		text: () => (dropped ? [`(${dropped} earlier moves let go)`, ...lines] : lines).join('\n'),
		clear: () => {
			lines = [];
			dropped = 0;
		},
		stop,
		[DISPOSE]: stop
	};
}
