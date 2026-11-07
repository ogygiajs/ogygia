/**
 * EVERY MESSAGE THE MACHINE PACKAGE PRINTS, in one place: its code, its wording, what to do about it.
 *
 * Each message ends with its code's page, `https://ogygiajs.dev/e/<code>?<args>`. The wording is
 * kept in dev and on the server; a production browser bundle drops the tables and prints the link
 * alone (the page words it from the link's arguments).
 */
import { BROWSER, DEV } from 'esm-env';

type Entry<A> = { text: (a: A) => string; details: () => string };

/** Each code and the arguments it is worded with. */
export type MachineErrors = {
	machine_illegal_move: Entry<{ name: string; from: string; to: string }>;
	machine_unknown_state: Entry<{ name: string; state: string; where: string }>;
	machine_unreachable_state: Entry<{ name: string; state: string; initial: string }>;
	machine_duplicate_step: Entry<{ name: string; from: string; to: string }>;
	machine_kind_in_data: Entry<{ name: string; state: string }>;
	machine_bad_option: Entry<{ option: string; value: string }>;
	machine_bad_timeout: Entry<{ name: string; state: string; problem: string }>;
	machine_timeout_not_a_time: Entry<{ name: string; state: string; ms: string }>;
	machine_timeout_failed: Entry<{ name: string; state: string }>;
	machine_timed_step_failed: Entry<{ name: string; from: string; to: string }>;
	machine_observer_failed: Entry<{ name: string }>;
};

/** The errors: thrown in dev (and tests), where a wrong move is a bug to fix now. */
export const MACHINE_ERRORS: MachineErrors = {
	machine_illegal_move: {
		text: (a: { name: string; from: string; to: string }): string =>
			`machine ${a.name}: cannot go from "${a.from}" to "${a.to}" (not in its steps).`,
		details: (): string =>
			'A machine was asked to go to a state its steps do not allow from the state it is in. ' +
			'Each state lists where it can go next (`steps`), and a move outside that list is refused.\n\n' +
			'In dev and tests the move throws. In production it is refused: the machine stays where it ' +
			'is, `go()` returns `false`, and this is printed once per machine, state and target.\n\n' +
			'Either add the target to the state in `steps`, or fix the code that moved it.'
	},
	machine_unknown_state: {
		text: (a: { name: string; state: string; where: string }): string =>
			`machine ${a.name}: "${a.state}" (${a.where}) is not one of its states.`,
		details: (): string =>
			'A machine definition named a state that is not a key of its `steps`: as `initial`, as a ' +
			"target in a state's list, or in `wait()`. Every state is a key of `steps`, a final state " +
			'with an empty list (`done: []`).'
	},
	machine_unreachable_state: {
		text: (a: { name: string; state: string; initial: string }): string =>
			`machine ${a.name}: state "${a.state}" can never be reached from "${a.initial}".`,
		details: (): string =>
			"No chain of steps leads from the machine's `initial` state to this state, so nothing can " +
			'ever enter it. Add a step that leads to it, or remove it.'
	},
	machine_duplicate_step: {
		text: (a: { name: string; from: string; to: string }): string =>
			`machine ${a.name}: "${a.from}" lists "${a.to}" twice in its steps.`,
		details: (): string => "Each target appears once in a state's list of steps."
	},
	machine_kind_in_data: {
		text: (a: { name: string; state: string }): string =>
			`machine ${a.name}: the data for "${a.state}" has a \`kind\` field.`,
		details: (): string =>
			"A state's `kind` is its name, set by the machine. Its data cannot carry its own `kind`. " +
			'Rename the field.'
	},
	machine_bad_option: {
		text: (a: { option: string; value: string }): string =>
			`machine: \`${a.option}\` must be a whole number of 0 or more (got ${a.value}).`,
		details: (): string => 'An option that counts something takes a whole number of 0 or more.'
	},
	machine_bad_timeout: {
		text: (a: { name: string; state: string; problem: string }): string =>
			`machine ${a.name}: the timeout of "${a.state}" cannot be used: ${a.problem}.`,
		details: (): string =>
			'A state in `after` ends on its own: still in it after `ms`, the machine takes the step `to`. ' +
			'`to` must be one of that state’s own `steps` (the timed step is a move like any other), and ' +
			'`ms` a number of 0 or more, or a function that makes one from the state’s value.\n\n' +
			'This is refused in every build: a timer set from it would fire a move the steps do not allow.\n\n' +
			'A timer holds at most 2^31 - 1 ms (about 24.8 days); Node and browsers run a longer delay ' +
			'after 1 ms, so a longer `ms` is refused too.'
	},
	machine_timeout_not_a_time: {
		text: (a: { name: string; state: string; ms: string }): string =>
			`machine ${a.name}: the timeout of "${a.state}" made ${a.ms}, not a time of 0 to 2147483647 ms; the state does not end on its own this time.`,
		details: (): string =>
			'A state in `after` whose `ms` is a function made a value no timer can hold: not a number, ' +
			'negative, or longer than 2^31 - 1 ms (about 24.8 days). Node and browsers would run such a ' +
			'timer after 1 ms and end the state at once, so this visit to the state gets no timeout ' +
			'instead. Make the function return a time in range (clamp it).'
	},
	machine_timeout_failed: {
		text: (a: { name: string; state: string }): string =>
			`machine ${a.name}: the timeout of "${a.state}" threw while making its time; the state does not end on its own this time.`,
		details: (): string =>
			'A state in `after` whose `ms` is a function threw when the machine entered the state. The ' +
			'error follows the message. This visit to the state gets no timeout; fix the function.'
	},
	machine_timed_step_failed: {
		text: (a: { name: string; from: string; to: string }): string =>
			`machine ${a.name}: the timed step from "${a.from}" to "${a.to}" failed.`,
		details: (): string =>
			"A state's timeout came, and taking its step failed: its `data` function threw (the " +
			'machine stays where it is), or a cleanup of the state it left threw (the step was taken). ' +
			'The error follows the message. A timer has no caller to throw to, so it is said here.'
	},
	machine_observer_failed: {
		text: (a: { name: string }): string =>
			`machine ${a.name}: an observer threw while hearing a move.`,
		details: (): string =>
			'A function given to `observe()` threw. The error follows the message. The move itself is ' +
			'done, and the other observers still heard it.'
	}
};

/** The warnings (none of its own: a refused move in production prints its error's code). */
export const MACHINE_WARNINGS: Record<string, Entry<never>> = {};

type Errors = MachineErrors;
type ArgsOf<C extends keyof Errors> = Parameters<Errors[C]['text']>[0];

function line(code: string, a: Record<string, string>): string {
	const params = new URLSearchParams();
	for (const name in a) if (a[name] !== '') params.set(name, a[name].slice(0, 300));
	const query = params.toString();
	const link = 'https://ogygiajs.dev/e/' + code + (query ? '?' + query : '');
	// dev and the server word it; a production browser bundle prints the link alone. The test sits
	// here, where it is used, so a bundler folds it and drops the tables with it.
	const entry =
		DEV || !BROWSER
			? ((MACHINE_ERRORS as Record<string, Entry<never>>)[code] as
					| Entry<Record<string, string>>
					| undefined)
			: undefined;
	return entry ? '[ogygia] ' + entry.text(a) + '\n' + link : '[ogygia] ' + link;
}

/** A machine error: `code` names its page. */
export class MachineError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = 'MachineError';
		this.code = code;
	}
}

/** The error for `code`, worded with its arguments. */
export function machine_error<C extends keyof Errors>(code: C, a: ArgsOf<C>): MachineError {
	return new MachineError(code, line(code, a));
}

/** Prints `code` as an error, with the error that caused it after it (a timer or an observer has no
 *  caller to throw to). */
export function report<C extends keyof Errors>(code: C, a: ArgsOf<C>, cause?: unknown): void {
	if (cause === undefined) console.error(line(code, a));
	else console.error(line(code, a), cause);
}

const warned = new Set<string>();

/** Prints `code` once for each distinct set of arguments. */
export function warn_once<C extends keyof Errors>(code: C, a: ArgsOf<C>): void {
	const text = line(code, a);
	if (warned.has(text)) return;
	warned.add(text);
	console.warn(text);
}
