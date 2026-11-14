import { bad_option, machine_error } from './messages.ts';

/** Dev and rules builds; folded out of any other (../rules-env.d.ts). */
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

/** What {@link decisions} takes. */
export interface DecisionsDef<I, P> {
	/** Names the table in messages. */
	name: string;
	/** Every value each input field can take: a finite list per field. Write them `as const` so the
	 *  input type is the values themselves. Tests walk every combination of them. */
	inputs: { [K in keyof I]: readonly I[K][] };
	/** Why no app can produce this combination, or `null` when one can. `decide()` throws on a
	 *  refused input (`machine_decision_refused`), in every build. */
	refuse?: (i: I) => string | null;
	/** The plan for an input. Pure: the same input always gives an equal plan. */
	decide: (i: I) => P;
}

/** A pure decision table made by {@link decisions}. */
export class Decisions<I, P> {
	/** The definition, as given: `@ogygia/machine/testing` walks it. */
	readonly def: DecisionsDef<I, P>;

	constructor(def: DecisionsDef<I, P>) {
		if (RULES) check_def(def);
		this.def = def;
	}

	/** The plan for `i`. Throws `machine_decision_refused` when `refuse` names a reason; in dev
	 *  and rules builds, also `machine_decision_outside` for a field outside its `inputs`. */
	decide(i: I): P {
		const def = this.def;
		if (RULES) check_input(def, i);
		if (def.refuse !== undefined) {
			const why = def.refuse(i);
			if (why !== null)
				throw machine_error('machine_decision_refused', {
					name: def.name,
					input: show_input(def.inputs, i),
					why
				});
		}
		return def.decide(i);
	}
}

/**
 * A pure decision table: every value each input field can take, and the plan for each
 * combination. Because the whole input space is listed, a test can walk every row of it
 * (`@ogygia/machine/testing`: `rows`, `check`, `table`, `dead_fields`, `count`).
 *
 *   const wake = decisions({
 *     name: 'wake',
 *     inputs: { trigger: ['load', 'visible', 'idle'], held: [false, true] } as const,
 *     refuse: (i) => (i.held && i.trigger === 'load' ? 'a held region never wakes on load' : null),
 *     decide: (i) => ({ now: i.trigger === 'load', observe: i.trigger === 'visible' })
 *   });
 *   wake.decide({ trigger: 'visible', held: false }); // { now: false, observe: true }
 */
export function decisions<I, P>(def: DecisionsDef<I, P>): Decisions<I, P> {
	return new Decisions(def);
}

function check_def<I, P>(def: DecisionsDef<I, P>): void {
	const inputs = def.inputs as Record<string, readonly unknown[]>;
	for (const field in inputs) {
		const domain = inputs[field];
		const option = `decisions ${def.name} inputs.${field}`;
		if (!Array.isArray(domain) || domain.length === 0)
			throw bad_option(option, show(domain), 'a list of at least one value');
		if (new Set(domain).size !== domain.length)
			throw bad_option(option, show_list(domain), 'a list with each value once');
	}
}

function check_input<I, P>(def: DecisionsDef<I, P>, i: I): void {
	const inputs = def.inputs as Record<string, readonly unknown[]>;
	const values = i as Record<string, unknown>;
	for (const field in inputs)
		if (!inputs[field].includes(values[field]))
			throw machine_error('machine_decision_outside', {
				name: def.name,
				field,
				value: show(values[field])
			});
}

/** `{ trigger: "load", held: true }`, in the order the fields are listed. */
export function show_input(inputs: object, i: unknown): string {
	const values = i as Record<string, unknown>;
	const parts: string[] = [];
	for (const field in inputs) parts.push(`${field}: ${show(values[field])}`);
	return `{ ${parts.join(', ')} }`;
}

function show_list(list: readonly unknown[]): string {
	return `[${list.map(show).join(', ')}]`;
}

/** A value as a message shows it: strings quoted, objects by their kind (never their content). */
export function show(v: unknown): string {
	if (typeof v === 'string') return JSON.stringify(v);
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'an array';
	if (typeof v === 'object') return 'an object';
	if (typeof v === 'function') return 'a function';
	return String(v);
}
