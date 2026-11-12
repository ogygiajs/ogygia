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
 * move goes through one place, which is what makes the rest possible: each visit to a state is a
 * scope (`m.scope`, ./scope.ts), so work started in it (`m.scope.task`) is aborted and its answer
 * dropped once the machine leaves, and what it holds (listeners, timers, observers, cleanups) is
 * released exactly once when it leaves; and a `wait()` for a state that can no longer be reached
 * settles at once instead of hanging.
 *
 * Speed: every machine of every definition is one class with one field layout, so the moves stay
 * on V8's fast path. The value of a visit is one small object, and a visit's scope and the waiter
 * list are made the first time they are needed: a move nothing hangs work on makes neither.
 */
import { DEV } from 'esm-env';
import { machine_error, report, warn_once } from './messages.ts';
import { registry } from './registry.ts';
import { CLOSED, is_time, MAX_TIMEOUT_MS, scope, visit_scope, type Scope } from './scope.ts';
import { STALE, type Stale } from './stale.ts';

export { STALE, type Stale };

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

/** The value of state `K`. */
export type StateIn<S, K extends Kind<S>> = Extract<StateOf<S>, { kind: K }>;

/**
 * How long state `K` lasts on its own, and the step it then takes: one of its own steps, with that
 * state's data made from the state it leaves (required exactly when the target has data).
 */
export type Timeout<S extends Shape<S>, T extends Steps<S>, K extends Kind<S>> = {
	[To in T[K][number] & Kind<S>]: {
		/** Milliseconds in the state before the step (0 or more), or made from the state's value. */
		readonly ms: number | ((now: StateIn<S, K>) => number);
		readonly to: To;
	} & ([keyof S[To]] extends [never]
		? { readonly data?: never }
		: {} extends S[To]
			? { readonly data?: (now: StateIn<S, K>) => S[To] }
			: { readonly data: (now: StateIn<S, K>) => S[To] });
}[T[K][number] & Kind<S>];

/** The states that end on their own after a time: `{ fetching: { ms: 10_000, to: 'failed', … } }`. */
export type After<S extends Shape<S>, T extends Steps<S>> = {
	readonly [K in Kind<S>]?: Timeout<S, T, K>;
};

export interface Config<S extends Shape<S>, T extends Steps<S>, I extends Kind<S>> {
	/** Names the machine in messages and to observers (minifiers rename functions, not this). */
	name: string;
	/** The state a machine starts in. */
	initial: I;
	/** Where each state can go next. */
	steps: ExactSteps<S, T>;
	/**
	 * States that end on their own: still in the state after `ms`, the machine takes the step `to`
	 * (a step of that state, checked as it is written). A move out of it first, or `stop()`,
	 * cancels it; coming back starts the time again. In place of a timer kept by hand beside the
	 * machine, which outlives the state it was for.
	 */
	after?: After<S, T>;
}

/** A definition as data: its states and steps, for devtools, docs and tests. */
export interface MachineGraph<K extends string = string> {
	readonly name: string;
	readonly initial: K;
	readonly states: readonly {
		readonly kind: K;
		/** Where it can go next. */
		readonly steps: readonly K[];
		/** No steps out. */
		readonly final: boolean;
		/** The step it takes on its own, and after how long (`null`: made from the state's value). */
		readonly after: { readonly to: K; readonly ms: number | null } | null;
	}[];
}

/** A machine definition: written once, at the top of a module. Its machines are made by `create`. */
export interface Definition<S extends Shape<S>, T extends Steps<S>, I extends Kind<S>> {
	readonly name: string;
	readonly initial: I;
	readonly steps: T;
	/** A new machine, in `initial` (with its data, if that state has data). */
	create(...data: DataArgs<S[I]>): Machine<S, T>;
	/** Its states and steps as data. */
	graph(): MachineGraph<Kind<S>>;
	/**
	 * Paths from `initial` that between them take every step at least once: for each step, the
	 * shortest path that reaches its state and takes it. Drive a machine down each in a test and
	 * every move the definition allows has run.
	 */
	paths(): Kind<S>[][];
}

/** A running machine. */
export interface Machine<S extends Shape<S>, T extends Steps<S>> {
	/**
	 * The state it is in. Read it once into a local to narrow it: `const s = m.now`. Each visit to
	 * a state is a new value, with no data too: after an `await`, `m.now === s` says the machine
	 * is still in the visit `s` was read in.
	 */
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
	 * The scope of the visit the machine is in now: leaving the state (or `stop()`) closes it. What
	 * hangs on it belongs to this visit alone, even when the machine comes back to the same state
	 * later:
	 *
	 * - `m.scope.task(work)`: its answer lands only in this visit, `STALE` once the machine left
	 *   (aborting `signal` then), even when `work` never finishes. After `await`, move on with
	 *   `move()`, which checks the machine is still where you expect.
	 * - `m.scope.defer(cleanup)`: runs once when the machine leaves, newest first. One that throws
	 *   does not stop the others or the move: once all have run, the move throws the error.
	 * - `m.scope.on(...)`, `.timeout(...)`, `.watch(...)`: a listener, timer or observer for this
	 *   visit only.
	 *
	 * On a stopped machine it is a closed scope: a task gives `STALE` without running, a cleanup
	 * runs at once.
	 */
	readonly scope: Scope;
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

/** Who watches every move, in the order they started: each held until its stop (never evicted). */
const observers = registry<Observer>();

/**
 * Watches every machine's moves (devtools, tests). Returns the function that stops watching. An
 * observer that throws is reported and does not break the move.
 */
export function observe(observer: Observer): () => void {
	// (its owner is the watch itself: the caller holds no scope to hand in, and its stop is the
	// watch's end)
	const watch = scope();
	observers.add(observer, watch);
	return () => watch.close();
}

function notify(name: string, from: State, to: State | null, machine: AnyMachine): void {
	// (the watchers at the move: one that stops another during the move does not cut it off)
	const list = observers.snapshot();
	for (let i = 0; i < list.length; i++) {
		try {
			list[i]!(name, from, to, machine);
		} catch (error) {
			report('machine_observer_failed', { name }, error);
		}
	}
}

type State = { readonly kind: string };
type Waiter = { kind: string; resolve: (value: State | Stale) => void };

/** A state's own timeout, linked to the state it steps to. */
interface Timed {
	readonly ms: number | ((now: State) => number);
	readonly to: Node;
	readonly data: ((now: State) => object) | undefined;
}

/** One state of a definition, linked straight to the states it steps to: a move walks a short
 *  array of these and never looks a name up. */
interface Node {
	readonly kind: string;
	readonly next: Node[];
	/** The step it takes on its own after a time, or null (most states: no cost to them). */
	timed: Timed | null;
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
		// (over the linked states, as a move walks them: a step naming no state, which a production
		// build keeps, leads nowhere)
		for (const start of def.nodes.values()) {
			const seen = new Set<string>();
			const queue = [...start.next];
			while (queue.length > 0) {
				const node = queue.pop() as Node;
				if (seen.has(node.kind)) continue;
				seen.add(node.kind);
				for (const next of node.next) if (!seen.has(next.kind)) queue.push(next);
			}
			reach.set(start.kind, seen);
		}
	}
	return reach.get(from) as Set<string>;
}

/**
 * The value of state `node` with `data`, new for each visit (with no data too): a saved `now` is
 * still `now` only while that visit lasts, so `m.now === mine` tells two visits apart.
 */
function state_of(def: Def, node: Node, data: object | undefined): State {
	const kind = node.kind;
	if (data === undefined) return DEV ? Object.freeze({ kind }) : { kind };
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
	_stopped = false;
	/** The visit's scope, once something asked for it: closed by the move that leaves the visit. */
	_scope: Scope | null = null;
	_waiters: Waiter[] | null = null;

	constructor(def: Def, node: Node, now: State) {
		this._def = def;
		this._node = node;
		this._now = now;
		if (node.timed !== null) this._arm(node.timed);
	}

	get now(): State {
		return this._now;
	}

	get scope(): Scope {
		if (this._scope !== null) return this._scope;
		if (this._stopped) return CLOSED;
		return (this._scope = visit_scope(this._def.name));
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
		const scope = this._scope;
		const waiters = this._waiters;
		this._scope = this._waiters = null;
		if (waiters !== null) for (const w of waiters) w.resolve(STALE);
		if (observers.size !== 0) notify(this._def.name, this._now, null, this);
		scope?.close();
	}

	/** The one place a move happens: the new state first, then everything the old one owned. */
	_enter(target: Node, data: object | undefined): void {
		const def = this._def;
		const next = state_of(def, target, data);
		const prev = this._now;
		this._node = target;
		this._now = next;
		// detached before anything runs, so a cleanup that moves the machine again starts clean
		const scope = this._scope;
		this._scope = null;
		// (armed before anything else runs: a waiter or an observer that moves the machine again
		// then leaves this visit, and closing it clears this timer)
		if (target.timed !== null) this._arm(target.timed);
		if (this._waiters !== null) this._settle(next);
		if (observers.size !== 0) notify(def.name, prev, next, this);
		scope?.close();
	}

	/**
	 * The state's own time: still in this visit when it is up, the machine takes the step. Leaving
	 * (or stopping) clears it. A failure while taking it (its data, a cleanup) is reported and the
	 * machine stays where it is: a timer has nobody to throw to.
	 */
	_arm(timed: Timed): void {
		let ms: unknown;
		try {
			ms = typeof timed.ms === 'function' ? timed.ms(this._now) : timed.ms;
		} catch (error) {
			report('machine_timeout_failed', { name: this._def.name, state: this._node.kind }, error);
			return;
		}
		// (a made time that is not one a timer can hold would be clamped to 1 ms: the state would end
		// at once; it does not end on its own instead, and says so)
		if (!is_time(ms)) {
			report('machine_timeout_not_a_time', {
				name: this._def.name,
				state: this._node.kind,
				ms: String(ms)
			});
			return;
		}
		// (the visit's own timer: leaving closes its scope, which clears it, so it only ever fires in
		// the visit that set it; and it never keeps a server process alive)
		this.scope.timeout(() => {
			const from = this._node.kind;
			try {
				this._enter(timed.to, timed.data === undefined ? undefined : timed.data(this._now));
			} catch (error) {
				report(
					'machine_timed_step_failed',
					{ name: this._def.name, from, to: timed.to.kind },
					error
				);
			}
		}, ms);
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

type TimeoutConfig = {
	ms: number | ((now: State) => number);
	to: string;
	data?: (now: State) => object;
};

function define(config: {
	name: string;
	initial: string;
	steps: Record<string, readonly string[]>;
	after?: Record<string, TimeoutConfig | undefined>;
}): object {
	const name = String(config.name);
	const steps: Record<string, readonly string[]> = Object.create(null);
	const nodes = new Map<string, Node>();
	for (const kind of Object.keys(config.steps)) {
		steps[kind] = Object.freeze([...config.steps[kind]]);
		nodes.set(kind, { kind, next: [], timed: null });
	}
	// a machine with no state to start in cannot run at all: refused in every build
	const initial = nodes.get(config.initial);
	if (initial === undefined)
		throw machine_error('machine_unknown_state', { name, state: config.initial, where: 'initial' });
	const def: Def = { name, initial, steps: Object.freeze(steps), nodes, reach: null };
	// link each state to the states it steps to (a production build skips a name that is not a
	// state, which dev refuses below: the move to it is then refused like any other)
	for (const node of nodes.values())
		for (const to of steps[node.kind]) {
			const target = nodes.get(to);
			if (target !== undefined && !node.next.includes(target)) node.next.push(target);
		}
	if (DEV) check(def);
	// each state's own timeout: refused in every build when it is not one of the state's steps, or
	// its time is not a time (a timer set from a bad definition would fire a move nobody allowed)
	for (const [kind, timeout] of Object.entries(config.after ?? {})) {
		if (timeout === undefined) continue;
		const node = nodes.get(kind);
		if (node === undefined)
			throw machine_error('machine_unknown_state', { name, state: kind, where: 'after' });
		const target = step_to(node, timeout.to);
		if (target === null)
			throw machine_error('machine_bad_timeout', {
				name,
				state: kind,
				problem: `"${timeout.to}" is not one of its steps`
			});
		const ms = timeout.ms;
		if (typeof ms !== 'function' && !is_time(ms))
			throw machine_error('machine_bad_timeout', {
				name,
				state: kind,
				problem: `its ms (${String(ms)}) is not a time of 0 to ${MAX_TIMEOUT_MS} (a timer holds no more)`
			});
		node.timed = { ms, to: target, data: timeout.data };
	}
	return Object.freeze({
		name,
		initial: initial.kind,
		steps: def.steps,
		create: (data?: object) => new Running(def, initial, state_of(def, initial, data)),
		graph: () => graph_of(def),
		paths: () => paths_of(def)
	});
}

function graph_of(def: Def): MachineGraph {
	return {
		name: def.name,
		initial: def.initial.kind,
		states: [...def.nodes.values()].map((node) => ({
			kind: node.kind,
			steps: def.steps[node.kind],
			final: def.steps[node.kind].length === 0,
			after:
				node.timed === null
					? null
					: {
							to: node.timed.to.kind,
							ms: typeof node.timed.ms === 'number' ? node.timed.ms : null
						}
		}))
	};
}

/** For each step, the shortest path from `initial` that reaches its state and then takes it. */
function paths_of(def: Def): string[][] {
	// the shortest way to each state (breadth first)
	const way = new Map<string, string[]>([[def.initial.kind, [def.initial.kind]]]);
	const queue = [def.initial.kind];
	while (queue.length > 0) {
		const kind = queue.shift() as string;
		for (const { kind: to } of (def.nodes.get(kind) as Node).next)
			if (!way.has(to)) {
				way.set(to, [...(way.get(kind) as string[]), to]);
				queue.push(to);
			}
	}
	const out: string[][] = [];
	for (const [kind, path] of way)
		for (const { kind: to } of (def.nodes.get(kind) as Node).next) out.push([...path, to]);
	return out;
}
