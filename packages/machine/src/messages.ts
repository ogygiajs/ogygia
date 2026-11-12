/**
 * EVERY MESSAGE THE MACHINE PACKAGE PRINTS, in one place: its code, its wording, what to do about it.
 *
 * Each message ends with its code's page, `https://ogygiajs.dev/e/<code>?<args>`. The wording is
 * kept in dev and on the server; a production browser bundle drops the tables and prints the link
 * alone (the page words it from the link's arguments).
 */
import { BROWSER, DEV } from 'esm-env';
import { say, type Say } from './say.ts';

type Entry<A> = { text: (a: A) => string; details: () => string };

/** Each code and the arguments it is worded with. */
export type MachineErrors = {
	machine_illegal_move: Entry<{ name: string; from: string; to: string }>;
	machine_unknown_state: Entry<{ name: string; state: string; where: string }>;
	machine_unreachable_state: Entry<{ name: string; state: string; initial: string }>;
	machine_duplicate_step: Entry<{ name: string; from: string; to: string }>;
	machine_kind_in_data: Entry<{ name: string; state: string }>;
	machine_bad_option: Entry<{ option: string; value: string; rule: string }>;
	machine_bad_time: Entry<{ where: string; ms: string }>;
	machine_not_disposable: Entry<{ value: string }>;
	machine_dispose_failed: Entry<{ owner: string }>;
	machine_bad_timeout: Entry<{ name: string; state: string; problem: string }>;
	machine_timeout_not_a_time: Entry<{ name: string; state: string; ms: string }>;
	machine_timeout_failed: Entry<{ name: string; state: string }>;
	machine_timed_step_failed: Entry<{ name: string; from: string; to: string }>;
	machine_observer_failed: Entry<{ name: string }>;
	machine_outbox_gave_up: Entry<{ name: string }>;
	machine_stage_step_failed: Entry<{ name: string }>;
	machine_mailbox_handler_failed: Entry<Record<string, never>>;
	machine_evict_failed: Entry<{ name: string; why: string }>;
	machine_flight_raise_failed: Entry<{ name: string }>;
	machine_queue_start_failed: Entry<{ name: string }>;
	machine_queue_stale_failed: Entry<{ name: string }>;
};

/** The errors: thrown in dev (and tests), where a wrong move is a bug to fix now. */
export const MACHINE_ERRORS: MachineErrors = {
	machine_illegal_move: {
		text: (a: { name: string; from: string; to: string }): string =>
			`machine ${a.name}: cannot go from "${a.from}" to "${a.to}" (not in its steps).`,
		details: (): string =>
			`A machine was asked to go to a state its steps do not allow from the state it is in. Each state lists where it can go next (\`steps\`), and a move outside that list is refused.

In dev and tests the move throws. In production it is refused: the machine stays where it is, \`go()\` returns \`false\`, and this is printed once per machine, state and target.

Either add the target to the state in \`steps\`, or fix the code that moved it.`
	},
	machine_unknown_state: {
		text: (a: { name: string; state: string; where: string }): string =>
			`machine ${a.name}: "${a.state}" (${a.where}) is not one of its states.`,
		details: (): string =>
			`A machine definition named a state that is not a key of its \`steps\`: as \`initial\`, as a target in a state's list, or in \`wait()\`. Every state is a key of \`steps\`, a final state with an empty list (\`done: []\`).`
	},
	machine_unreachable_state: {
		text: (a: { name: string; state: string; initial: string }): string =>
			`machine ${a.name}: state "${a.state}" can never be reached from "${a.initial}".`,
		details: (): string =>
			`No chain of steps leads from the machine's \`initial\` state to this state, so nothing can ever enter it. Add a step that leads to it, or remove it.`
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
			`A state's \`kind\` is its name, set by the machine. Its data cannot carry its own \`kind\`. Rename the field.`
	},
	machine_bad_option: {
		text: (a: { option: string; value: string; rule: string }): string =>
			`machine: \`${a.option}\` must be ${a.rule} (got ${a.value}).`,
		details: (): string =>
			`An option was given a value it cannot take. \`retries\` counts tries: a whole number of 0 or more. A flights \`keep\` is milliseconds: 0 or more, \`Infinity\` for until \`max\` lets it go. A flights or cache \`max\` is the most weight it keeps: a finite number more than 0 (a cache with no bound is refused). A \`say()\` \`max\` is the most keys it remembers: a whole number, 1 or more.`
	},
	machine_bad_time: {
		text: (a: { where: string; ms: string }): string =>
			`machine: ${a.where} was given ${a.ms}, not a time of 0 to 2147483647 ms.`,
		details: (): string =>
			`A scope's \`timeout()\` takes milliseconds, \`'frame'\` or \`'idle'\`, and \`every()\` takes milliseconds: a number of 0 to 2^31 - 1 (about 24.8 days). Node and browsers run a timer with a longer, negative or non-number delay after 1 ms, so it is refused instead.`
	},
	machine_not_disposable: {
		text: (a: { value: string }): string =>
			`machine: a scope cannot adopt this ${a.value}: it has no Symbol.dispose or Symbol.asyncDispose.`,
		details: (): string =>
			`\`adopt()\` takes what disposes itself: an object with a \`[Symbol.dispose]()\` or \`[Symbol.asyncDispose]()\` method (a flights, a scope, a lock holder). For anything else, hand the scope its release: \`defer(() => x.close())\`, \`watch(observer)\` for an observer.`
	},
	machine_dispose_failed: {
		text: (a: { owner: string }): string =>
			`machine: an async disposal of a ${a.owner} failed after it closed.`,
		details: (): string =>
			`A scope closed with \`close()\` (or \`using\`) and something it adopted disposes itself asynchronously (\`Symbol.asyncDispose\`); that disposal rejected. The error follows the message. Nobody waited for it, so it is said here: close with \`await using\` or \`await s[Symbol.asyncDispose]()\` to wait for such disposals and get their errors.`
	},
	machine_bad_timeout: {
		text: (a: { name: string; state: string; problem: string }): string =>
			`machine ${a.name}: the timeout of "${a.state}" cannot be used: ${a.problem}.`,
		details: (): string =>
			`A state in \`after\` ends on its own: still in it after \`ms\`, the machine takes the step \`to\`. \`to\` must be one of that state’s own \`steps\` (the timed step is a move like any other), and \`ms\` a number of 0 or more, or a function that makes one from the state’s value.

This is refused in every build: a timer set from it would fire a move the steps do not allow.

A timer holds at most 2^31 - 1 ms (about 24.8 days); Node and browsers run a longer delay after 1 ms, so a longer \`ms\` is refused too.`
	},
	machine_timeout_not_a_time: {
		text: (a: { name: string; state: string; ms: string }): string =>
			`machine ${a.name}: the timeout of "${a.state}" made ${a.ms}, not a time of 0 to 2147483647 ms; the state does not end on its own this time.`,
		details: (): string =>
			`A state in \`after\` whose \`ms\` is a function made a value no timer can hold: not a number, negative, or longer than 2^31 - 1 ms (about 24.8 days). Node and browsers would run such a timer after 1 ms and end the state at once, so this visit to the state gets no timeout instead. Make the function return a time in range (clamp it).`
	},
	machine_timeout_failed: {
		text: (a: { name: string; state: string }): string =>
			`machine ${a.name}: the timeout of "${a.state}" threw while making its time; the state does not end on its own this time.`,
		details: (): string =>
			`A state in \`after\` whose \`ms\` is a function threw when the machine entered the state. The error follows the message. This visit to the state gets no timeout; fix the function.`
	},
	machine_timed_step_failed: {
		text: (a: { name: string; from: string; to: string }): string =>
			`machine ${a.name}: the timed step from "${a.from}" to "${a.to}" failed.`,
		details: (): string =>
			`A state's timeout came, and taking its step failed: its \`data\` function threw (the machine stays where it is), or a cleanup of the state it left threw (the step was taken). The error follows the message. A timer has no caller to throw to, so it is said here.`
	},
	machine_observer_failed: {
		text: (a: { name: string }): string =>
			`machine ${a.name}: an observer threw while hearing a move.`,
		details: (): string =>
			`A function given to \`observe()\` threw. The error follows the message. The move itself is done, and the other observers still heard it.`
	},
	machine_outbox_gave_up: {
		text: (a: { name: string }): string =>
			`outbox ${a.name}: a send ran out of tries, so it is given up.`,
		details: (): string =>
			`An \`outbox()\` tried a send as many times as its \`retry\` policy allows (or until its deadline), and every try failed. The last error follows the message. Nothing of it is kept: the work it carried did not happen.

Give the outbox a \`giveUp\` to say it in your own words, or to keep the work somewhere it survives. A \`giveUp\` that throws is said here too.`
	},
	machine_stage_step_failed: {
		text: (a: { name: string }): string =>
			`stage ${a.name}: a step that gives back a change threw.`,
		details: (): string =>
			`A \`stage()\` gives back what it changed when it does not commit (its \`discard\` steps) or when its commit throws part way (its \`undo\` steps). One of those steps threw. The error follows the message. The other steps still ran; whatever this step should have put back may still be in place.`
	},
	machine_mailbox_handler_failed: {
		text: (): string => 'mailbox: a handler that waited for its turn threw.',
		details: (): string =>
			`A \`mailbox()\` handler threw while it ran in its turn, after events ahead of it. Nobody waits on its stack (it was posted earlier, by someone who has moved on), so its error goes to the page's error handler (\`reportError\`: the console and \`window.onerror\`), as an event listener's would, and the box goes on with the next event.

A handler that runs at once (posted to an idle box) throws to its poster instead, and one posted with \`ask()\` rejects its asker's promise. Catch inside the handler to handle it there.`
	},
	machine_evict_failed: {
		text: (a: { name: string; why: string }): string =>
			`${a.name}: an eviction notice (${a.why}) threw.`,
		details: (): string =>
			`A \`cache()\`'s \`onEvict\` threw while it heard a value leave. The value had already left: the cache goes on, and the notices after it still run. Its error follows this message. Catch inside \`onEvict\` when a cleanup can fail.`
	},
	machine_flight_raise_failed: {
		text: (a: { name: string }): string =>
			`flights ${a.name}: a run's \`onRaise\` listener threw when a caller raised its flight.`,
		details: (): string =>
			`A \`flights()\` run listened for its flight's priority going up (\`flight.onRaise\`), and the listener threw when a caller joined at a higher priority. The caller that joined is not the one at fault, so it is not failed: the error goes to the page's error handler (\`reportError\`: the console and \`window.onerror\`), as an event listener's would. The flight is raised all the same, and its other listeners still hear it.

Catch inside the listener to handle it there.`
	},
	machine_queue_start_failed: {
		text: (a: { name: string }): string =>
			`queue ${a.name}: a job's \`start\` threw as the drain started it.`,
		details: (): string =>
			`A \`queue()\` started a job with its \`start\` option, and it threw. The job is the one at fault, so the drain is not stopped: the error goes to the page's error handler (\`reportError\`: the console and \`window.onerror\`), as a task would, and the jobs after it still start. The job counts as started: release its place when its work is done.

Catch inside \`start\` to handle it there.`
	},
	machine_queue_stale_failed: {
		text: (a: { name: string }): string =>
			`queue ${a.name}: a job's \`stale\` threw as the job left the queue.`,
		details: (): string =>
			`A \`queue()\` told a waiting job it was stale (its deadline came, it was cancelled, or the owner closed) through its \`stale\` option, and it threw. The job is the one at fault, so the queue goes on: the error goes to the page's error handler (\`reportError\`: the console and \`window.onerror\`), and the other waiting jobs still go stale or start, so none waits forever.

Catch inside \`stale\` to handle it there.`
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
	const link = `https://ogygiajs.dev/e/${code}${query ? `?${query}` : ''}`;
	// dev and the server word it; a production browser bundle prints the link alone. The test sits
	// here, where it is used, so a bundler folds it and drops the tables with it.
	const entry =
		DEV || !BROWSER
			? ((MACHINE_ERRORS as Record<string, Entry<never>>)[code] as
					| Entry<Record<string, string>>
					| undefined)
			: undefined;
	return entry ? `[ogygia] ${entry.text(a)}\n${link}` : `[ogygia] ${link}`;
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

/** The error for an option given a value it cannot take (`machine_bad_option`). */
export function bad_option(option: string, value: unknown, rule: string): MachineError {
	return machine_error('machine_bad_option', { option, value: String(value), rule });
}

/** Prints `code` as an error, with the error that caused it after it (a timer or an observer has no
 *  caller to throw to). */
export function report<C extends keyof Errors>(code: C, a: ArgsOf<C>, cause?: unknown): void {
	if (cause === undefined) console.error(line(code, a));
	else console.error(line(code, a), cause);
}

/** Prints `code`, then hands `cause` (an app's own error, thrown where nobody waits for it) to the
 *  page's error handler (`reportError`: the console and `window.onerror`, where error monitoring
 *  sees it), as an uncaught throw would be. Where there is none (a server, a test), it follows the
 *  message. */
export function report_thrown<C extends keyof Errors>(code: C, a: ArgsOf<C>, cause: unknown): void {
	const page = (globalThis as { reportError?: (e: unknown) => void }).reportError;
	if (typeof page !== 'function') return report(code, a, cause);
	console.error(line(code, a));
	page(cause);
}

/** The warnings said, by their text (bounded: say.ts). Made on the first warning: say.ts imports
 *  this module. */
let warned: Say | null = null;

/** Prints `code` once for each distinct set of arguments (of the last 1024 said). */
export function warn_once<C extends keyof Errors>(code: C, a: ArgsOf<C>): void {
	const text = line(code, a);
	(warned ??= say()).once(text, () => console.warn(text));
}
