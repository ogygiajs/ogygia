/**
 * One state value in place of a pile of flags.
 *
 *   const hole = machine<{ idle: {}; fetching: { attempt: number }; failed: { error: unknown } }>()({
 *     name: 'hole',
 *     initial: 'idle',
 *     steps: { idle: ['fetching'], fetching: ['idle', 'failed'], failed: ['fetching'] }
 *   });
 *   const h = hole.create();
 *   h.go('fetching', { attempt: 1 });
 *
 * A machine is in exactly one state at a time, and a state can only go where its `steps` say. Every
 * move goes through one place, which is what makes the rest possible: work started in a state
 * (`task`) is aborted and its answer dropped once the machine leaves it, cleanups tied to a state
 * (`onLeave`) run exactly once when it leaves, and a `wait()` for a state that can no longer be
 * reached settles at once instead of hanging.
 *
 * Speed: every machine of every definition is one class with one field layout, so the moves stay
 * on V8's fast path. A state with no data is one frozen object shared by every machine of its
 * definition, so most moves allocate nothing. The abort controller, the cleanup list and the
 * waiter list are made the first time they are needed.
 */
import { DEV } from 'esm-env';
import { machine_error, warn_once } from './messages.ts';

/** What `task()` and `wait()` give back when the machine moved on before the answer arrived. */
export const STALE: unique symbol = Symbol.for('ogygia.machine.stale');
export type Stale = typeof STALE;

/** The data each state carries, by state name: `{ idle: {}; failed: { error: unknown } }`. A
 *  state's data cannot have a `kind` field: that is the state's name. */
export type Shape<S> = { [K in keyof S]: object & { kind?: never } };

/** A state name of `S`. */
export type Kind<S> = keyof S & string;

/** The machine's state: one value, `kind` plus that state's data. Narrows on `kind`. */
export type StateOf<S> = { [K in Kind<S>]: Readonly<{ kind: K } & S[K]> }[Kind<S>];

/** Where each state can go next. A final state has an empty list. */
export type Steps<S> = { readonly [K in Kind<S>]: readonly Kind<S>[] };

/** The data argument of a move to a state with data `D`: none for a state with no data, optional
 *  when all of it is optional, required otherwise. */
export type DataArgs<D> = [keyof D] extends [never] ? [] : {} extends D ? [data?: D] : [data: D];

/** The steps written in the definition: every state, and nothing else. */
type ExactSteps<S, T> = T & { readonly [K in Exclude<keyof T, keyof S>]: never };

export interface Config<S extends Shape<S>, T extends Steps<S>, I extends Kind<S>> {
	/** Names the machine in messages and to observers (minifiers rename functions, not this). */
	name: string;
	/** The state a machine starts in. */
	initial: I;
	/** Where each state can go next. */
	steps: ExactSteps<S, T>;
}

/** A machine definition: written once, at the top of a module. Its machines are made by `create`. */
export interface Definition<S extends Shape<S>, T extends Steps<S>, I extends Kind<S>> {
	readonly name: string;
	readonly initial: I;
	readonly steps: T;
	/** A new machine, in `initial` (with its data, if that state has data). */
	create(...data: DataArgs<S[I]>): Machine<S, T>;
}

/** A running machine. */
export interface Machine<S extends Shape<S>, T extends Steps<S>> {
	/** The state it is in. Read it once into a local to narrow it: `const s = m.now`. */
	readonly now: StateOf<S>;
	/**
	 * Go to `to` from whatever state the machine is in, if that state's steps allow it. Returns
	 * `true` when it moved. A move the steps do not allow throws in dev; in production it is
	 * refused (`false`) and printed once. A stopped machine refuses quietly.
	 */
	go<K extends T[Kind<S>][number]>(to: K, ...data: DataArgs<S[K & keyof S]>): boolean;
	/**
	 * Go from `from` to `to`, only if the machine is still in `from`: `false`, quietly, when
	 * something else moved it first. The move is checked against the steps when it is written.
	 */
	move<F extends Kind<S>, K extends T[F][number]>(
		from: F,
		to: K,
		...data: DataArgs<S[K & keyof S]>
	): boolean;
	/**
	 * Runs `work` for the state the machine is in now. Leaving that state aborts `signal` and
	 * settles the task with `STALE` right then, even when `work` never finishes, and even when the
	 * machine comes back to the same state later: an answer only ever lands in the visit that asked
	 * for it. A failure after the machine left is `STALE` too. A stopped machine gives `STALE`
	 * without running `work`.
	 *
	 * After `await`, move on with `move()`, which checks the machine is still where you expect.
	 */
	task<R>(work: (signal: AbortSignal) => R): Promise<Awaited<R> | Stale>;
	/**
	 * Runs `cleanup` once, when the machine leaves the state it is in now (or stops). Cleanups run
	 * last-added first. One that throws does not stop the others or the move: once all have run,
	 * the move throws the error. On a stopped machine, `cleanup` runs at once.
	 */
	onLeave(cleanup: () => void): void;
	/**
	 * The next time the machine is in `kind`: at once when it is in it now. `STALE` as soon as
	 * `kind` can no longer be reached from where the machine is, or when it stops, so a wait never
	 * hangs on a state that cannot come.
	 */
	wait<K extends Kind<S>>(kind: K): Promise<Extract<StateOf<S>, { kind: K }> | Stale>;
	/** Ends the machine: leaves its state (aborting its tasks and running its cleanups), settles
	 *  its waits with `STALE`, and refuses every move after. Safe to call twice. */
	stop(): void;
}

/** Any machine, as an observer sees it. */
export interface AnyMachine {
	readonly now: { readonly kind: string };
}

/** Told about every move of every machine: `to` is `null` when the machine stopped. */
export type Observer = (
	name: string,
	from: { readonly kind: string },
	to: { readonly kind: string } | null,
	machine: AnyMachine
) => void;

let observers: readonly Observer[] = [];

/**
 * Watches every machine's moves (devtools, tests). Returns the function that stops watching. An
 * observer that throws is reported and does not break the move.
 */
export function observe(observer: Observer): () => void {
	observers = [...observers, observer];
	return () => {
		observers = observers.filter((o) => o !== observer);
	};
}

function notify(name: string, from: State, to: State | null, machine: AnyMachine): void {
	const list = observers;
	for (let i = 0; i < list.length; i++) {
		try {
			list[i](name, from, to, machine);
		} catch (error) {
			console.error('[ogygia] a machine observer threw', error);
		}
	}
}

type State = { readonly kind: string };
type Waiter = { kind: string; resolve: (value: State | Stale) => void };

/** One state of a definition, linked straight to the states it steps to: a move walks a short
 *  array of these and never looks a name up. */
interface Node {
	readonly kind: string;
	readonly next: Node[];
	/** The shared, frozen value of this state with no data. */
	readonly empty: State;
}

/** A definition as the machines read it. */
interface Def {
	readonly name: string;
	readonly initial: Node;
	/** Null-prototype: a state named like an `Object.prototype` key is still only itself. */
	readonly steps: Readonly<Record<string, readonly string[]>>;
	readonly nodes: ReadonlyMap<string, Node>;
	/** The states reachable from each state in one or more steps (built on the first `wait`). */
	reach: Map<string, Set<string>> | null;
}

function has_step(steps: readonly string[], to: string): boolean {
	for (let i = 0; i < steps.length; i++) if (steps[i] === to) return true;
	return false;
}

function step_to(node: Node, to: string): Node | null {
	const next = node.next;
	for (let i = 0; i < next.length; i++) if (next[i].kind === to) return next[i];
	return null;
}

function reach_of(def: Def, from: string): Set<string> {
	let reach = def.reach;
	if (reach === null) {
		reach = def.reach = new Map();
		for (const start in def.steps) {
			const seen = new Set<string>();
			const queue = [...def.steps[start]];
			while (queue.length > 0) {
				const kind = queue.pop() as string;
				if (seen.has(kind)) continue;
				seen.add(kind);
				for (const next of def.steps[kind]) if (!seen.has(next)) queue.push(next);
			}
			reach.set(start, seen);
		}
	}
	return reach.get(from) as Set<string>;
}

/** The value of state `node` with `data`: the shared empty value when there is none. */
function state_of(def: Def, node: Node, data: object | undefined): State {
	if (data === undefined) return node.empty;
	const kind = node.kind;
	if (DEV) {
		if (Object.hasOwn(data, 'kind'))
			throw machine_error('machine_kind_in_data', { name: def.name, state: kind });
		return Object.freeze({ ...data, kind });
	}
	return { ...data, kind };
}

function illegal(def: Def, from: string, to: string): false {
	const args = { name: def.name, from, to };
	if (DEV) throw machine_error('machine_illegal_move', args);
	warn_once('machine_illegal_move', args);
	return false;
}

/**
 * Every machine is one of these: one class, one field layout, whatever its definition. Its fields
 * are plain (`_`) rather than `#private`: a `#` field read costs about twice as much on V8, on the
 * path every move takes. The public type (`Machine`) shows none of them.
 */
class Running implements AnyMachine {
	_def: Def;
	/** The state it is in, as the definition's node (its steps) and as its value (`now`). */
	_node: Node;
	_now: State;
	/** Bumped by every move and by `stop`: a task's answer lands only while it is unchanged. */
	_visit = 0;
	_stopped = false;
	_leave: (() => void)[] | null = null;
	_abort: AbortController | null = null;
	_waiters: Waiter[] | null = null;

	constructor(def: Def, node: Node, now: State) {
		this._def = def;
		this._node = node;
		this._now = now;
	}

	get now(): State {
		return this._now;
	}

	go(to: string, data?: object): boolean {
		if (this._stopped) return false;
		const target = step_to(this._node, to);
		if (target === null) return illegal(this._def, this._node.kind, to);
		this._enter(target, data);
		return true;
	}

	move(from: string, to: string, data?: object): boolean {
		if (this._stopped) return false;
		const node = this._node;
		if (node.kind === from) {
			const target = step_to(node, to);
			if (target === null) return illegal(this._def, from, to);
			this._enter(target, data);
			return true;
		}
		// not in `from`: a lost race (quiet), unless the step itself does not exist
		const steps = this._def.steps[from];
		if (steps === undefined || !has_step(steps, to)) return illegal(this._def, from, to);
		return false;
	}

	task<R>(work: (signal: AbortSignal) => R): Promise<Awaited<R> | Stale> {
		if (this._stopped) return Promise.resolve(STALE);
		const visit = this._visit;
		const signal = (this._abort ??= new AbortController()).signal;
		let out: R | Promise<never>;
		try {
			out = work(signal);
		} catch (error) {
			out = Promise.reject(error);
		}
		return new Promise((resolve, reject) => {
			// settles the moment the visit ends, even when `work` ignores its signal and never does
			const on_leave = () => resolve(STALE);
			signal.addEventListener('abort', on_leave, { once: true });
			Promise.resolve(out).then(
				(value) => {
					signal.removeEventListener('abort', on_leave);
					resolve(this._visit === visit ? value : STALE);
				},
				(error: unknown) => {
					signal.removeEventListener('abort', on_leave);
					if (this._visit === visit) reject(error);
					else resolve(STALE);
				}
			);
		});
	}

	onLeave(cleanup: () => void): void {
		if (this._stopped) cleanup();
		else (this._leave ??= []).push(cleanup);
	}

	wait(kind: string): Promise<State | Stale> {
		if (!this._def.nodes.has(kind)) {
			if (DEV)
				throw machine_error('machine_unknown_state', {
					name: this._def.name,
					state: kind,
					where: 'wait()'
				});
			return Promise.resolve(STALE);
		}
		if (this._stopped) return Promise.resolve(STALE);
		const now = this._now;
		if (now.kind === kind) return Promise.resolve(now);
		if (!reach_of(this._def, now.kind).has(kind)) return Promise.resolve(STALE);
		return new Promise((resolve) => (this._waiters ??= []).push({ kind, resolve }));
	}

	stop(): void {
		if (this._stopped) return;
		this._stopped = true;
		this._visit++;
		const leave = this._leave;
		const abort = this._abort;
		const waiters = this._waiters;
		this._leave = this._abort = this._waiters = null;
		if (waiters !== null) for (const w of waiters) w.resolve(STALE);
		if (observers.length !== 0) notify(this._def.name, this._now, null, this);
		this._exit(leave, abort);
	}

	/** The one place a move happens: the new state first, then everything the old one owned. */
	_enter(target: Node, data: object | undefined): void {
		const def = this._def;
		const next = data === undefined ? target.empty : state_of(def, target, data);
		const prev = this._now;
		this._node = target;
		this._now = next;
		this._visit++;
		// detached before anything runs, so a cleanup that moves the machine again starts clean
		const leave = this._leave;
		const abort = this._abort;
		this._leave = null;
		this._abort = null;
		if (this._waiters !== null) this._settle(next);
		if (observers.length !== 0) notify(def.name, prev, next, this);
		if (leave !== null || abort !== null) this._exit(leave, abort);
	}

	_settle(next: State): void {
		const waiters = this._waiters as Waiter[];
		let reach: Set<string> | null = null;
		let kept = 0;
		for (let i = 0; i < waiters.length; i++) {
			const w = waiters[i];
			if (w.kind === next.kind) w.resolve(next);
			else if (!(reach ??= reach_of(this._def, next.kind)).has(w.kind)) w.resolve(STALE);
			else waiters[kept++] = w;
		}
		waiters.length = kept;
		if (kept === 0 && this._waiters === waiters) this._waiters = null;
	}

	_exit(leave: (() => void)[] | null, abort: AbortController | null): void {
		abort?.abort();
		if (leave === null) return;
		let errors: unknown[] | null = null;
		for (let i = leave.length - 1; i >= 0; i--) {
			try {
				leave[i]();
			} catch (error) {
				(errors ??= []).push(error);
			}
		}
		if (errors !== null)
			throw errors.length === 1
				? errors[0]
				: new AggregateError(
						errors,
						`[ogygia] machine ${this._def.name}: ${errors.length} cleanups threw`
					);
	}
}

/** The checks a definition passes before its first machine: dev and tests only. */
function check(def: Def): void {
	const { name, initial, steps } = def;
	for (const from in steps) {
		const list = steps[from];
		for (let i = 0; i < list.length; i++) {
			const to = list[i];
			if (!(to in steps))
				throw machine_error('machine_unknown_state', {
					name,
					state: to,
					where: `a step of "${from}"`
				});
			if (list.indexOf(to) !== i) throw machine_error('machine_duplicate_step', { name, from, to });
		}
	}
	const reached = reach_of(def, initial.kind);
	for (const kind in steps)
		if (kind !== initial.kind && !reached.has(kind))
			throw machine_error('machine_unreachable_state', {
				name,
				state: kind,
				initial: initial.kind
			});
	def.reach = null;
}

/**
 * Defines a machine: first its states' data (`machine<{ ... }>()`), then its name, initial state
 * and steps. Two calls because TypeScript cannot take half the types from you and infer the
 * other half: the second call reads the exact steps, so a move they do not allow fails to compile.
 */
export function machine<S extends Shape<S>>(): <const T extends Steps<S>, const I extends Kind<S>>(
	config: Config<S, T, I>
) => Definition<S, T, I> {
	return define as never;
}

function define(config: {
	name: string;
	initial: string;
	steps: Record<string, readonly string[]>;
}): object {
	const name = String(config.name);
	const steps: Record<string, readonly string[]> = Object.create(null);
	const nodes = new Map<string, Node>();
	for (const kind of Object.keys(config.steps)) {
		steps[kind] = Object.freeze([...config.steps[kind]]);
		nodes.set(kind, { kind, next: [], empty: Object.freeze({ kind }) });
	}
	// a machine with no state to start in cannot run at all: refused in every build
	const initial = nodes.get(config.initial);
	if (initial === undefined)
		throw machine_error('machine_unknown_state', { name, state: config.initial, where: 'initial' });
	const def: Def = { name, initial, steps: Object.freeze(steps), nodes, reach: null };
	if (DEV) check(def);
	// link each state to the states it steps to (a production build skips a name that is not a
	// state, which dev refused above: the move to it is then refused like any other)
	for (const node of nodes.values())
		for (const to of steps[node.kind]) {
			const target = nodes.get(to);
			if (target !== undefined && !node.next.includes(target)) node.next.push(target);
		}
	return Object.freeze({
		name,
		initial: initial.kind,
		steps: def.steps,
		create: (data?: object) => new Running(def, initial, state_of(def, initial, data))
	});
}
