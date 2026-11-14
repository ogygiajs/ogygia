import { show, show_input, type Decisions } from './decisions.ts';
import { bad_option, machine_error } from './messages.ts';

/** One combination of a table's inputs: its plan, or why it is refused. */
export type Row<I, P> =
	| { readonly input: I; readonly plan: P }
	| { readonly input: I; readonly refused: string };

/** How much of a table a listing walks. */
export interface ListOptions {
	/** The most combinations a listing walks before it refuses (`machine_decisions_too_many`).
	 *  Default 100,000. */
	max?: number;
	/** Walk `size` distinct combinations picked by `seed` instead of every one: the same seed
	 *  picks the same combinations, in the same order. */
	sample?: { seed: number; size: number };
}

/** Named rules for {@link check}: each returns true when it holds for the row. */
export type Rules<I, P> = Record<string, (row: Row<I, P>) => boolean>;

/** A table definition with its type parameters erased, as the walk reads it. */
type Table = Decisions<Record<string, unknown>, unknown>;

const DEFAULT_MAX = 100_000;

/** The combinations a listing walks, as index tuples (one index into each field's list). */
class Walk {
	readonly fields: string[];
	readonly domains: (readonly unknown[])[];
	readonly full: boolean;
	readonly #sample: { seed: number; size: number } | undefined;

	constructor(d: Table, options: ListOptions) {
		const inputs = d.def.inputs as Record<string, readonly unknown[]>;
		this.fields = Object.keys(inputs);
		this.domains = this.fields.map((field) => inputs[field]);
		const max = options.max ?? DEFAULT_MAX;
		if (!(max >= 1)) throw bad_option('listing max', max, 'a number, 1 or more');
		const all = product(this.domains);
		const sample = options.sample;
		if (sample !== undefined) {
			if (!Number.isInteger(sample.seed))
				throw bad_option('sample seed', sample.seed, 'a whole number');
			if (!Number.isInteger(sample.size) || sample.size < 1)
				throw bad_option('sample size', sample.size, 'a whole number, 1 or more');
		}
		this.full = sample === undefined || sample.size >= all;
		const walked = this.full ? all : (sample as { size: number }).size;
		if (walked > max)
			throw machine_error('machine_decisions_too_many', {
				name: d.def.name,
				count: String(all),
				max: String(max)
			});
		this.#sample = this.full ? undefined : sample;
	}

	*indices(): Generator<number[]> {
		if (this.#sample !== undefined) yield* this.#sampled(this.#sample);
		else yield* this.#every();
	}

	*#every(): Generator<number[]> {
		const at = this.fields.map(() => 0);
		for (;;) {
			yield at.slice();
			let f = at.length - 1;
			while (f >= 0 && ++at[f] === this.domains[f].length) at[f--] = 0;
			if (f < 0) return;
		}
	}

	*#sampled({ seed, size }: { seed: number; size: number }): Generator<number[]> {
		const random = new Mulberry(seed);
		const exact = product(this.domains) <= Number.MAX_SAFE_INTEGER;
		const seen = new Set<number | string>();
		while (seen.size < size) {
			const at: number[] = [];
			let index = 0;
			for (const domain of this.domains) {
				const v = Math.floor(random.next() * domain.length);
				at.push(v);
				index = index * domain.length + v;
			}
			const key = exact ? index : at.join(',');
			if (seen.has(key)) continue;
			seen.add(key);
			yield at;
		}
	}

	input(at: readonly number[]): Record<string, unknown> {
		const input: Record<string, unknown> = {};
		for (let f = 0; f < at.length; f++) input[this.fields[f]] = this.domains[f][at[f]];
		return input;
	}
}

/** A seeded pseudo-random stream (mulberry32): the same seed gives the same numbers. */
class Mulberry {
	#state: number;
	constructor(seed: number) {
		this.#state = seed >>> 0;
	}
	next(): number {
		let t = (this.#state = (this.#state + 0x6d2b79f5) >>> 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
}

function product(domains: readonly (readonly unknown[])[]): number {
	let n = 1;
	for (const domain of domains) n *= domain.length;
	return n;
}

function row_of(d: Table, input: Record<string, unknown>): Row<unknown, unknown> {
	const why = d.def.refuse?.(input) ?? null;
	return why === null ? { input, plan: d.decide(input) } : { input, refused: why };
}

/** How many combinations the table's inputs make (the product of their list lengths). */
export function count<I, P>(d: Decisions<I, P>): number {
	return product(Object.values(d.def.inputs as Record<string, readonly unknown[]>));
}

/**
 * Every combination of the table's inputs, lazily: `{ input, plan }`, or `{ input, refused }` where
 * `refuse` names a reason. Fields vary in the order `inputs` lists them, the last fastest. Throws
 * `machine_decisions_too_many` at once (not on the first step) past `max`; `sample` walks a
 * seeded few instead.
 */
export function rows<I, P>(d: Decisions<I, P>, options: ListOptions = {}): Generator<Row<I, P>> {
	const table = d as unknown as Table;
	const walk = new Walk(table, options);
	return each_row(table, walk) as Generator<Row<I, P>>;
}

function* each_row(d: Table, walk: Walk): Generator<Row<unknown, unknown>> {
	for (const at of walk.indices()) yield row_of(d, walk.input(at));
}

/**
 * Runs every named rule over every row. Throws `machine_decisions_rule_broken` naming each rule
 * that returned false (or threw) with the first row that broke it; otherwise returns how many
 * rows it checked.
 */
export function check<I, P>(
	d: Decisions<I, P>,
	rules: Rules<I, P>,
	options: ListOptions = {}
): number {
	const names = Object.keys(rules);
	const broken = new Map<string, string>();
	let checked = 0;
	for (const row of rows(d, options)) {
		checked++;
		for (const name of names) {
			if (broken.has(name)) continue;
			let held: boolean;
			let threw = '';
			try {
				held = rules[name](row) === true;
			} catch (error) {
				held = false;
				threw = ` (the rule threw: ${error instanceof Error ? error.message : String(error)})`;
			}
			if (!held)
				broken.set(
					name,
					`- ${name}: ${show_row(d.def.inputs, row as Row<unknown, unknown>)}${threw}`
				);
		}
	}
	if (broken.size > 0)
		throw machine_error('machine_decisions_rule_broken', {
			name: d.def.name,
			broken: [...broken.values()].join('\n')
		});
	return checked;
}

function show_row(inputs: object, row: Row<unknown, unknown>): string {
	const outcome = 'refused' in row ? `refused (${row.refused})` : show_data(row.plan);
	return `${show_input(inputs, row.input)} -> ${outcome}`;
}

/** Plain data as text: objects and arrays by their content, other values as messages show them. */
function show_data(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(show_data).join(', ')}]`;
	if (is_plain(v)) {
		const parts = Object.keys(v).map((key) => `${key}: ${show_data(v[key])}`);
		return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
	}
	return show(v);
}

function is_plain(v: unknown): v is Record<string, unknown> {
	if (typeof v !== 'object' || v === null) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

/**
 * The table as markdown: one row per combination, each input field a column, then the plan's
 * fields (a nested object flattened: `head.runtime`), and `refused` when any row is refused.
 * Columns are padded to line up.
 */
export function table<I, P>(d: Decisions<I, P>, options: ListOptions = {}): string {
	const fields = Object.keys(d.def.inputs as object);
	const plan_columns: string[] = [];
	let any_refused = false;
	const lines: Map<string, string>[] = [];
	for (const row of rows(d, options) as Generator<Row<Record<string, unknown>, unknown>>) {
		const cells = new Map<string, string>();
		for (const field of fields) cells.set(field, cell(row.input[field]));
		if ('refused' in row) {
			any_refused = true;
			cells.set('\0refused', cell(row.refused));
		} else {
			const flat = new Map<string, string>();
			flatten(row.plan, '', flat);
			for (const [column, value] of flat) {
				if (!plan_columns.includes(column)) plan_columns.push(column);
				cells.set(`\0${column}`, value);
			}
		}
		lines.push(cells);
	}
	const keys = [
		...fields,
		...plan_columns.map((column) => `\0${column}`),
		...(any_refused ? ['\0refused'] : [])
	];
	const heads = keys.map((key) => escape(key.startsWith('\0') ? key.slice(1) : key));
	const widths = heads.map((head, k) =>
		Math.max(3, head.length, ...lines.map((cells) => (cells.get(keys[k]) ?? '').length))
	);
	const line = (texts: readonly string[]): string =>
		`| ${texts.map((text, k) => text.padEnd(widths[k])).join(' | ')} |`;
	return [
		line(heads),
		line(widths.map((width) => '-'.repeat(width))),
		...lines.map((cells) => line(keys.map((key) => cells.get(key) ?? '')))
	].join('\n');
}

function flatten(v: unknown, prefix: string, out: Map<string, string>): void {
	if (is_plain(v) && Object.keys(v).length > 0) {
		for (const key of Object.keys(v))
			flatten(v[key], prefix === '' ? key : `${prefix}.${key}`, out);
		return;
	}
	out.set(prefix === '' ? 'plan' : prefix, cell(v));
}

function cell(v: unknown): string {
	return escape(typeof v === 'string' ? v : show_data(v));
}

function escape(text: string): string {
	if (!text.includes('|') && !text.includes('\n')) return text;
	return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/**
 * The input fields whose value never changes the outcome (the plan, or the refusal): for every
 * combination of the other fields, each of its values gives an equal outcome. A field with one
 * value is always dead. With `sample`, only the sampled combinations are varied.
 */
export function dead_fields<I, P>(
	d: Decisions<I, P>,
	options: ListOptions = {}
): (keyof I & string)[] {
	const table = d as unknown as Table;
	const walk = new Walk(table, options);
	const outcomes = new Map<string, Row<unknown, unknown>>();
	const outcome = (at: readonly number[]): Row<unknown, unknown> => {
		const key = at.join(',');
		let row = outcomes.get(key);
		if (row === undefined) outcomes.set(key, (row = row_of(table, walk.input(at))));
		return row;
	};
	const live = walk.fields.map(() => false);
	for (const at of walk.indices())
		for (let f = 0; f < walk.fields.length; f++) {
			if (live[f] || (walk.full && at[f] !== 0)) continue;
			const first = outcome(at);
			const other = at.slice();
			for (let v = 0; v < walk.domains[f].length && !live[f]; v++) {
				if (v === at[f]) continue;
				other[f] = v;
				if (!same_outcome(first, outcome(other))) live[f] = true;
			}
		}
	return walk.fields.filter((_, f) => !live[f]) as (keyof I & string)[];
}

function same_outcome(a: Row<unknown, unknown>, b: Row<unknown, unknown>): boolean {
	if ('refused' in a || 'refused' in b)
		return 'refused' in a && 'refused' in b && a.refused === b.refused;
	return same(a.plan, b.plan);
}

function same(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (Array.isArray(a))
		return Array.isArray(b) && a.length === b.length && a.every((v, k) => same(v, b[k]));
	if (!is_plain(a) || !is_plain(b)) return false;
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
	);
}
