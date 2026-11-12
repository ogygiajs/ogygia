/**
 * COVERAGE: what a run reached, for a search to steer by. Two kinds:
 *
 * - **Machine steps.** Every machine of the packages a simulated app runs is plain data
 *   (`machine()({ name, initial, steps })`), and its `paths()` is one path per step. So the steps,
 *   `name: from -> to`, are the targets: {@link universe} reads them from the source, and a run's
 *   reached steps come from each document's machine moves (`__ogygia_moves()`, rules builds).
 *   A `flights()` is a machine too: its entries move under the flights' own `name`.
 * - **Buggify points.** Each rare branch a run was asked about, whether the swarm turned it on, and
 *   how often it fired (`World.buggified`).
 *
 * The browser realms only: a server's machines are bundled into its build, where the simulator does
 * not hear them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

/** One machine's definition, as its source spells it. */
export interface MachineDef {
	readonly name: string;
	/** The package it is in (`core`, `federation`, ...). */
	readonly pkg: string;
	readonly file: string;
	readonly initial: string;
	readonly steps: Readonly<Record<string, readonly string[]>>;
}

/** The packages whose machines a simulated app can run (in a page or on its server). */
const PACKAGES = ['machine', 'core', 'federation', 'postrender', 'router', 'flags'];

type Node = { type: string; [k: string]: unknown };

const is = (n: unknown, type: string): n is Node =>
	typeof n === 'object' && n !== null && (n as Node).type === type;

/** The node under `as const`, `satisfies` and parentheses. */
function bare(n: unknown): unknown {
	while (
		is(n, 'TSAsExpression') ||
		is(n, 'TSSatisfiesExpression') ||
		is(n, 'ParenthesizedExpression')
	)
		n = (n as Node).expression;
	return n;
}

const literal = (n: unknown): string | null => {
	const b = bare(n);
	return is(b, 'Literal') && typeof b.value === 'string' ? b.value : null;
};

/** An object literal's property `key`. */
function prop(o: Node, key: string): unknown {
	for (const p of o.properties as Node[]) {
		if (!is(p, 'Property')) continue;
		const k = p.key as Node;
		if ((is(k, 'Identifier') && k.name === key) || literal(k) === key) return p.value;
	}
	return undefined;
}

/** A `steps` object (inline, or a const of the file), as data; null when it is not plain. */
function steps_of(n: unknown, consts: Map<string, unknown>): Record<string, string[]> | null {
	let o = bare(n);
	if (is(o, 'Identifier')) o = bare(consts.get(o.name as string));
	if (!is(o, 'ObjectExpression')) return null;
	const out: Record<string, string[]> = {};
	for (const p of o.properties as Node[]) {
		if (!is(p, 'Property')) return null;
		const k = p.key as Node;
		const from = is(k, 'Identifier') ? (k.name as string) : literal(k);
		const v = bare(p.value);
		if (from === null || !is(v, 'ArrayExpression')) return null;
		const to = (v.elements as unknown[]).map(literal);
		if (to.some((t) => t === null)) return null;
		out[from] = to as string[];
	}
	return out;
}

function walk(n: unknown, visit: (n: Node) => void): void {
	if (Array.isArray(n)) {
		for (const c of n) walk(c, visit);
		return;
	}
	if (typeof n !== 'object' || n === null) return;
	if (typeof (n as Node).type === 'string') visit(n as Node);
	for (const v of Object.values(n)) if (typeof v === 'object') walk(v, visit);
}

function files(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const at = join(dir, e.name);
		if (e.isDirectory()) out.push(...files(at));
		else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(at);
	}
	return out;
}

/**
 * Every machine the packages define, by name, read from their source: `machine<S>()({ ... })` with
 * a literal name, and each `flights({ name })` (its entries' steps, from flights' own definition).
 */
export function universe(root: string): Map<string, MachineDef> {
	const out = new Map<string, MachineDef>();
	const flights_named: Array<{ name: string; pkg: string; file: string }> = [];
	let flights_steps: Record<string, string[]> | null = null;
	for (const pkg of PACKAGES)
		for (const file of files(join(root, 'packages', pkg, 'src'))) {
			const source = readFileSync(file, 'utf8');
			if (!source.includes('machine<') && !source.includes('flights')) continue;
			const ast = parseAst(source, { lang: 'ts' }) as unknown as Node;
			const consts = new Map<string, unknown>();
			for (const s of ast.body as Node[])
				if (is(s, 'VariableDeclaration'))
					for (const d of s.declarations as Node[])
						if (is(d.id, 'Identifier')) consts.set(d.id.name as string, d.init);
			const rel = file.slice(root.length + 1);
			walk(ast, (n) => {
				if (!is(n, 'CallExpression')) return;
				const callee = n.callee as Node;
				const config = bare((n.arguments as unknown[])[0]);
				if (!is(config, 'ObjectExpression')) return;
				// machine<S>()({ ... })
				if (
					is(callee, 'CallExpression') &&
					is(callee.callee, 'Identifier') &&
					callee.callee.name === 'machine'
				) {
					const steps = steps_of(prop(config, 'steps'), consts);
					const initial = literal(prop(config, 'initial'));
					if (steps === null || initial === null) return;
					const name = literal(prop(config, 'name'));
					// (flights' own entry machine: named by each flights)
					if (name === null) {
						if (pkg === 'machine' && rel.endsWith('flights.ts')) flights_steps = steps;
						return;
					}
					out.set(name, { name, pkg, file: rel, initial, steps });
					return;
				}
				// flights({ name }) and flights.keyed<I>()({ name })
				const is_flights =
					(is(callee, 'Identifier') && callee.name === 'flights') ||
					(is(callee, 'CallExpression') &&
						is(callee.callee, 'MemberExpression') &&
						is((callee.callee as Node).object, 'Identifier') &&
						((callee.callee as Node).object as Node).name === 'flights');
				const name = is_flights ? literal(prop(config, 'name')) : null;
				if (name !== null) flights_named.push({ name, pkg, file: rel });
			});
		}
	if (flights_steps !== null)
		for (const f of flights_named)
			if (!out.has(f.name)) out.set(f.name, { ...f, initial: 'flying', steps: flights_steps });
	return out;
}

/** A step as coverage counts it. */
export const step_key = (name: string, from: string, to: string): string =>
	`${name}: ${from} -> ${to}`;

/** Every step of `machines`. */
export function all_steps(machines: Map<string, MachineDef>): Set<string> {
	const out = new Set<string>();
	for (const m of machines.values())
		for (const [from, tos] of Object.entries(m.steps))
			for (const to of tos) out.add(step_key(m.name, from, to));
	return out;
}

/** A move line of `__ogygia_moves()` (`hole#3 idle -> loading`) as a step; null for a stop. */
export function step_of_move(line: string): string | null {
	const m = /^(.+)#\d+ (\S+) -> (\S+)$/.exec(line);
	if (m === null || m[3] === 'stopped') return null;
	return step_key(m[1], m[2], m[3]);
}

/**
 * The lines of a document's move log not read before: the log keeps its last lines and says how
 * many older ones it let go, so the lines past `read` (a count of all lines ever) are the new ones.
 * Returns them and the new count.
 */
export function new_moves(text: string, read: number): { lines: string[]; total: number } {
	const lines = text === '' ? [] : text.split('\n');
	const head = /^\((\d+) earlier moves let go\)$/.exec(lines[0] ?? '');
	const dropped = head ? Number(head[1]) : 0;
	const kept = head ? lines.slice(1) : lines;
	const total = dropped + kept.length;
	return { lines: kept.slice(Math.max(0, kept.length - (total - read))), total };
}

/** What a run reached: steps hit (with counts) and each buggify point's asks. */
export interface RunCoverage {
	readonly steps: Record<string, number>;
	readonly points: Record<string, { on: boolean; asked: number; fired: number }>;
}

/** Coverage over many runs. */
export class Coverage {
	readonly steps = new Map<string, number>();
	readonly points = new Map<string, { asked: number; fired: number }>();

	/** Adds a run; returns what was new: steps and points that fired for the first time. */
	add(run: RunCoverage): string[] {
		const fresh: string[] = [];
		for (const [s, n] of Object.entries(run.steps)) {
			if (!this.steps.has(s)) fresh.push(s);
			this.steps.set(s, (this.steps.get(s) ?? 0) + n);
		}
		for (const [p, c] of Object.entries(run.points)) {
			const had = this.points.get(p);
			if (c.fired > 0 && !(had && had.fired > 0)) fresh.push(`buggify ${p}`);
			this.points.set(p, {
				asked: (had?.asked ?? 0) + c.asked,
				fired: (had?.fired ?? 0) + c.fired
			});
		}
		return fresh;
	}

	/** Steps reached of `machines`' steps, overall and per machine (machines a run touched first). */
	report(machines: Map<string, MachineDef>): {
		reached: number;
		total: number;
		machines_touched: number;
		per_machine: Array<{
			name: string;
			pkg: string;
			reached: number;
			total: number;
			missing: string[];
		}>;
		/** Steps reached that no definition has (a machine named at run time, an illegal move). */
		unknown: string[];
	} {
		const every = all_steps(machines);
		const per_machine = [...machines.values()]
			.map((m) => {
				const steps = Object.entries(m.steps).flatMap(([from, tos]) =>
					tos.map((to) => step_key(m.name, from, to))
				);
				const reached = steps.filter((s) => this.steps.has(s)).length;
				return {
					name: m.name,
					pkg: m.pkg,
					reached,
					total: steps.length,
					missing: steps.filter((s) => !this.steps.has(s))
				};
			})
			.sort((a, b) => b.reached - a.reached || a.name.localeCompare(b.name));
		return {
			reached: [...this.steps.keys()].filter((s) => every.has(s)).length,
			total: every.size,
			machines_touched: per_machine.filter((m) => m.reached > 0).length,
			per_machine,
			unknown: [...this.steps.keys()].filter((s) => !every.has(s)).sort()
		};
	}
}
