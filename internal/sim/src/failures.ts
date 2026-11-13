/**
 * EVERY FAILURE SITE ACCOUNTED FOR. Each place in the packages' source that can fail in real life
 * is a site: a catch, a `.catch(` or two-handler `.then`, a fetch, a `!res.ok`, a STALE check, an
 * `import()`, a storage call, a JSON parse, a timer (`setTimeout`, a scope's or AbortSignal's
 * `timeout`), an observer, a retry policy, an abort (`AbortController`, `.aborted`, `'AbortError'`),
 * an error event (`'error'`/`'abort'` listeners, `onerror`), a stream (`getReader`, `enqueue`, a
 * controller's `error`/`close`), a message (`postMessage`, `sendBeacon`, a channel), a `throw` (a
 * failure some caller must handle), a machine `.move('from', 'to')` (refused when the state moved on), an
 * `{ ok: false }` result, a crypto call (`crypto.subtle`, `verify`, `timingSafeEqual`) and a body
 * that may be null (`!x.body`, `x.body === null`). Each has a stable id: `file > enclosing function > kind:n` (n counts that kind in that function, in source
 * order). The ledger, `internal/sim/failures.json`, puts each site in exactly one bucket:
 *
 * - `fired`: a buggify point (`point`, which a `buggify.fires('<point>')` in the packages' source
 *   must ask) or a sim fault (`fault`, one of network.ts's `FaultClass`) reaches it in the standard
 *   sweep; with `--sweep`, a named point must have fired in the sweep's results;
 * - `covered`: a real test reaches it: `test` (a file from the repo root) holds a test named `name`;
 * - `impossible`: it cannot fail, and a rule or type says so: `by` (a file from the repo root) holds
 *   `name` (the rule's name, or the type's), and `why` says how.
 *
 * Sites nobody has bucketed yet are the `baseline`: the check allows it, but it may only shrink. A
 * baseline id no site has any more fails (take it out), and with `--base <rev>` a baseline id the
 * base's ledger did not list fails (a new site goes in a bucket, never the baseline). A site in no
 * bucket and not in the baseline fails, and so does a ledger entry no site has.
 *
 *   node src/failures.ts                       the static check (the PR check job)
 *   node src/failures.ts --base <rev>          and the baseline may not grow against <rev>
 *   node src/failures.ts --sweep <results>...  and each `fired` point fired in the sweep's results
 *   node src/failures.ts --list                print every site, with its line
 *   node src/failures.ts --list --packages a,b the sites of other packages (outside the scope)
 *   node src/failures.ts --write-baseline      set the baseline to every site in no bucket
 *
 * test/failures.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseSync } from 'rolldown/utils';

export type Node = Record<string, unknown> & { type: string; start: number; end: number };

/** What kind of failure a site is. */
export type SiteKind =
	| 'catch'
	| '.catch'
	| 'reject'
	| 'fetch'
	| 'not-ok'
	| 'stale'
	| 'import'
	| 'storage'
	| 'parse'
	| 'timer'
	| 'observer'
	| 'policy'
	| 'abort'
	| 'error-event'
	| 'stream'
	| 'message'
	| 'throw'
	| 'refused'
	| 'result'
	| 'crypto'
	| 'body';

export interface Site {
	readonly id: string;
	readonly file: string;
	readonly line: number;
	readonly kind: SiteKind;
}

const STORAGE: ReadonlySet<string> = new Set([
	'localStorage',
	'sessionStorage',
	'indexedDB',
	'caches'
]);

/** The name a function node is known by, or null for an anonymous one (its sites go to the named
 *  function around it). */
function fn_name(node: Node, parent: Node | null): string | null {
	const id = node.id as Node | null | undefined;
	if (id && id.type === 'Identifier') return String(id.name);
	if (!parent) return null;
	const key = (k: unknown): string | null => {
		const n = k as Node | undefined;
		if (!n) return null;
		if (n.type === 'Identifier' || n.type === 'PrivateIdentifier') return String(n.name);
		if (n.type === 'Literal') return String(n.value);
		return null;
	};
	if (parent.type === 'VariableDeclarator') return key(parent.id);
	if (parent.type === 'Property' || parent.type === 'MethodDefinition') return key(parent.key);
	if (parent.type === 'PropertyDefinition') return key(parent.key);
	if (parent.type === 'AssignmentExpression') {
		const left = parent.left as Node;
		if (left.type === 'Identifier') return String(left.name);
		if (left.type === 'MemberExpression') return key(left.property);
	}
	return null;
}

const FUNCTIONS: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression'
]);

/** The member a call is made on (`x.catch(...)` is `catch`), or the callee's name. */
function callee_name(call: Node): { name: string | null; object: string | null } {
	const c = call.callee as Node;
	if (c.type === 'Identifier') return { name: String(c.name), object: null };
	if (c.type === 'MemberExpression' && !c.computed) {
		const o = c.object as Node;
		return {
			name: String((c.property as Node).name),
			object: o.type === 'Identifier' ? String(o.name) : null
		};
	}
	return { name: null, object: null };
}

/** The events a failure is told by. */
const ERROR_EVENTS: ReadonlySet<string> = new Set([
	'error',
	'abort',
	'messageerror',
	'unhandledrejection'
]);

/** The handler properties those events are told to. */
const ERROR_HANDLERS: ReadonlySet<string> = new Set([
	'onerror',
	'onabort',
	'onmessageerror',
	'onunhandledrejection'
]);

/** `x.body`: a response's body, null when it has none. */
function is_body(n: Node): boolean {
	return n.type === 'MemberExpression' && !n.computed && (n.property as Node).name === 'body';
}

/** The kind of failure site `node` is, or null. `parent` is the node around it. */
function kind_of(node: Node, parent: Node | null): SiteKind | null {
	switch (node.type) {
		case 'CatchClause':
			return 'catch';
		case 'ImportExpression':
			return 'import';
		case 'ThrowStatement':
			return 'throw';
		case 'NewExpression': {
			const c = node.callee as Node;
			if (c.type !== 'Identifier') return null;
			const name = String(c.name);
			if (name.endsWith('Observer')) return 'observer';
			if (name === 'AbortController') return 'abort';
			if (name === 'BroadcastChannel' || name === 'MessageChannel') return 'message';
			return null;
		}
		case 'Literal':
			return node.value === 'AbortError' ? 'abort' : null;
		case 'Property': {
			const key = node.key as Node;
			const value = node.value as Node;
			if (node.computed || key.type !== 'Identifier') return null;
			if (key.name === 'ok' && value.type === 'Literal' && value.value === false) return 'result';
			if (ERROR_HANDLERS.has(String(key.name))) return 'error-event';
			return null;
		}
		case 'BinaryExpression': {
			if (!['===', '!==', '==', '!='].includes(String(node.operator))) return null;
			const left = node.left as Node;
			const right = node.right as Node;
			const is_stale = (n: Node) => n.type === 'Identifier' && n.name === 'STALE';
			if (is_stale(left) || is_stale(right)) return 'stale';
			const is_null = (n: Node) => n.type === 'Literal' && n.value === null;
			if ((is_body(left) && is_null(right)) || (is_body(right) && is_null(left))) return 'body';
			return null;
		}
		case 'UnaryExpression':
			return node.operator === '!' && is_body(node.argument as Node) ? 'body' : null;
		case 'MemberExpression': {
			if (node.computed) return null;
			const o = node.object as Node;
			if (o.type === 'Identifier' && STORAGE.has(String(o.name))) {
				const call = parent?.type === 'CallExpression' && parent.callee === node;
				return call || parent?.type !== 'MemberExpression' ? 'storage' : null;
			}
			const p = node.property as Node;
			if (p.name === 'ok' && parent?.type === 'UnaryExpression' && parent.operator === '!')
				return 'not-ok';
			if (p.name === 'aborted') return 'abort';
			if (
				ERROR_HANDLERS.has(String(p.name)) &&
				parent?.type === 'AssignmentExpression' &&
				parent.left === node
			)
				return 'error-event';
			return null;
		}
		case 'CallExpression': {
			const { name, object } = callee_name(node);
			if (name === null) return null;
			const args = node.arguments as Node[];
			const callee = node.callee as Node;
			const member = callee.type === 'MemberExpression';
			if (name === 'catch' && member) return '.catch';
			if (name === 'then' && args.length >= 2) return 'reject';
			if (name === 'fetch') return 'fetch';
			if (name === 'parse' && object === 'JSON') return 'parse';
			if (name === 'policy' && object === null) return 'policy';
			if (name === 'setTimeout' || name === 'timeout') return 'timer';
			if (
				(name === 'addEventListener' || (name === 'on' && member)) &&
				args.slice(0, 2).some((a) => a.type === 'Literal' && ERROR_EVENTS.has(String(a.value)))
			)
				return 'error-event';
			if (name === 'getReader' || name === 'enqueue') return 'stream';
			if ((name === 'error' || name === 'close') && object !== null && /controller/i.test(object))
				return 'stream';
			if (name === 'postMessage' || name === 'sendBeacon') return 'message';
			if (
				name === 'move' &&
				member &&
				args.length >= 2 &&
				args[0].type === 'Literal' &&
				typeof args[0].value === 'string'
			)
				return 'refused';
			if (name === 'timingSafeEqual') return 'crypto';
			if (name === 'verify' && object !== null && /crypto|subtle|hmac/i.test(object))
				return 'crypto';
			if (member) {
				const o = callee.object as Node;
				if (o.type === 'MemberExpression' && (o.property as Node).name === 'subtle')
					return 'crypto';
			}
			return null;
		}
		default:
			return null;
	}
}

/** A site with the AST node that makes it and the node around that one (src/autopilot.ts places its
 *  probes and mutants by them). */
export interface SiteNode extends Site {
	readonly node: Node;
	readonly parent: Node | null;
}

/** Every failure site of one source file (`file`, from the repo root). */
export function sites_of(file: string, source: string): Site[] {
	return site_nodes(file, source).map(({ id, line, kind }) => ({ id, file, line, kind }));
}

/** {@link sites_of}, with each site's node. */
export function site_nodes(file: string, source: string): SiteNode[] {
	const { program } = parseSync(file, source);
	const lines: number[] = [0];
	for (let i = 0; i < source.length; i++) if (source[i] === '\n') lines.push(i + 1);
	const line_of = (at: number): number => {
		let lo = 0;
		let hi = lines.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lines[mid] <= at) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};
	const out: SiteNode[] = [];
	const counts = new Map<string, number>();
	const walk = (node: Node, parent: Node | null, path: readonly string[]): void => {
		let here = path;
		if (FUNCTIONS.has(node.type)) {
			const name = fn_name(node, parent);
			if (name !== null) here = [...path, name];
		} else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
			const name = fn_name(node, parent);
			if (name !== null) here = [...path, name];
		}
		const kind = kind_of(node, parent);
		if (kind !== null) {
			const where = here.length ? here.join(' > ') : '(module)';
			const at = `${file} > ${where} > ${kind}`;
			const n = counts.get(at) ?? 0;
			counts.set(at, n + 1);
			out.push({ id: `${at}:${n}`, file, line: line_of(node.start), kind, node, parent });
		}
		for (const key in node) {
			if (key === 'type' || key === 'start' || key === 'end') continue;
			const v = node[key];
			if (Array.isArray(v)) {
				for (const c of v)
					if (c && typeof c === 'object' && 'type' in c) walk(c as Node, node, here);
			} else if (v && typeof v === 'object' && 'type' in v) walk(v as Node, node, here);
		}
	};
	walk(program as unknown as Node, null, []);
	return out;
}

/** Where `source` is, by function: each named function or class (`Class > method`, `fn > inner`, the
 *  path a site's id names), with its span. An anonymous function is its named parent's, as a site
 *  in it is. */
export function functions_of(
	file: string,
	source: string
): { readonly path: string; readonly start: number; readonly end: number }[] {
	const { program } = parseSync(file, source);
	const out: { path: string; start: number; end: number }[] = [];
	const walk = (node: Node, parent: Node | null, path: readonly string[]): void => {
		let here = path;
		if (
			FUNCTIONS.has(node.type) ||
			node.type === 'ClassDeclaration' ||
			node.type === 'ClassExpression'
		) {
			const name = fn_name(node, parent);
			if (name !== null) {
				here = [...path, name];
				out.push({ path: here.join(' > '), start: node.start, end: node.end });
			}
		}
		for (const key in node) {
			if (key === 'type' || key === 'start' || key === 'end') continue;
			const v = node[key];
			if (Array.isArray(v)) {
				for (const c of v)
					if (c && typeof c === 'object' && 'type' in c) walk(c as Node, node, here);
			} else if (v && typeof v === 'object' && 'type' in v) walk(v as Node, node, here);
		}
	};
	walk(program as unknown as Node, null, []);
	return out;
}

/** The path of the innermost named function around offset `at` (`(module)` when none is). */
export function function_at(
	functions: readonly {
		readonly path: string;
		readonly start: number;
		readonly end: number;
	}[],
	at: number
): string {
	let best: { path: string; start: number; end: number } | null = null;
	for (const f of functions)
		if (f.start <= at && at < f.end && (best === null || f.end - f.start < best.end - best.start))
			best = f;
	return best?.path ?? '(module)';
}

/** Which source the inventory reads: the packages, and the files in them it leaves out. */
export interface Scope {
	/** Package directories under packages/: their src/ is read. */
	readonly packages: readonly string[];
	/** Paths from the repo root (a directory ends in `/`) that are not runtime or server code. */
	readonly exclude: readonly { readonly path: string; readonly why: string }[];
	/** Packages no simulator runs (the cli, build config, the e2e harness): their sites are
	 *  `covered` by real tests, never `fired`. The compiler is not one: the compiler's own
	 *  simulator (a dev session against a cold build) fires its sites. */
	readonly build_time?: readonly string[];
}

/** The `.ts` files of `scope`, from the repo root, in a stable order. */
export function scope_files(root: string, scope: Scope): string[] {
	const out: string[] = [];
	const visit = (dir: string): void => {
		for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0
		)) {
			const abs = join(dir, e.name);
			const rel = relative(root, abs);
			if (scope.exclude.some((x) => (x.path.endsWith('/') ? `${rel}/` : rel) === x.path)) continue;
			if (scope.exclude.some((x) => x.path.endsWith('/') && rel.startsWith(x.path))) continue;
			if (e.isDirectory()) visit(abs);
			else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.endsWith('.test.ts'))
				out.push(rel);
		}
	};
	for (const p of scope.packages) {
		const src = join(root, 'packages', p, 'src');
		if (existsSync(src)) visit(src);
	}
	return out;
}

export interface Fired {
	readonly site: string;
	/** The buggify point that reaches it. */
	readonly point?: string;
	/** Or the sim fault that does. */
	readonly fault?: string;
	/** Or the random app's shape that does (a gen stream, as gen.ts forks it: `gen messy` draws a hole
	 *  whose render throws, whose answer is a 500). */
	readonly shape?: string;
	/** Which simulator fires it: the app simulator (internal/sim, the default) or the compiler's
	 *  (a dev session's edits, fs and watcher faults, against a cold build). */
	readonly sim?: 'app' | 'compiler';
	/** How it reaches the site. */
	readonly how: string;
	/** The proof its recovery is checked: a mutant of `internal/sim/mutants.json` that breaks the
	 *  recovery and the simulator kills (the daily mutation run keeps proving it). Absent while the
	 *  recovery is unproved. */
	readonly killed_by?: string;
}

export interface Covered {
	readonly site: string;
	readonly reason: string;
	readonly test: string;
	readonly name: string;
}

export interface Impossible {
	readonly site: string;
	readonly why: string;
	/** The file that holds the rule or type, from the repo root. */
	readonly by: string;
	/** The rule's or type's name, as its file spells it. */
	readonly name: string;
}

export interface FailureLedger {
	readonly scope: Scope;
	readonly fired: readonly Fired[];
	readonly covered: readonly Covered[];
	readonly impossible: readonly Impossible[];
	/** Sites nobody has bucketed yet. It may only shrink. */
	readonly baseline: readonly string[];
	/** Points that fire no failure site but a machine's recovery steps (a keep running out early:
	 *  `kept -> gone`), which the steps ledger accounts for. Every point the source asks is named by a
	 *  `fired` entry or here: no orphan points. */
	readonly step_points?: readonly StepPoint[];
}

export interface StepPoint {
	readonly point: string;
	/** The machine steps it leads to, as the steps ledger spells them. */
	readonly steps: readonly string[];
	readonly how: string;
	/** The mutant that breaks the recovery the point leads to and the simulator kills, as
	 *  {@link Fired.killed_by}. */
	readonly killed_by?: string;
}

export interface FailureAccounting {
	readonly accounted: number;
	readonly total: number;
	readonly baseline: number;
	/** Fired sites whose recovery a killed mutant proves checked. */
	readonly proved: number;
	/** Why the check fails, one line each. */
	readonly failures: string[];
}

/**
 * Accounts for `sites` (every site id) with `ledger`. `read` gives a file's text from the repo root
 * (null when it is not there); `points` are the buggify points the packages ask; `faults` the sim's
 * fault classes. With `base` (the base ledger's baseline), the baseline may not grow; with `fired`
 * (the points a sweep fired), each `fired` entry's point must be among them.
 */
export function account_failures(
	sites: ReadonlySet<string>,
	ledger: FailureLedger,
	o: {
		read: (path: string) => string | null;
		points: ReadonlySet<string>;
		faults: ReadonlySet<string>;
		/** The mutants the daily run judges (mutants.json, not `equivalent`). */
		mutants: ReadonlySet<string>;
		/** The random app's shapes: the streams gen.ts forks (`gen messy`, …). */
		shapes: ReadonlySet<string>;
		/** Points the random app's own code asks (gen.ts: a pass that fails as an app's does). A
		 *  fired site may name one; no orphan check, as they are not the packages'. */
		app_points?: ReadonlySet<string>;
		base?: ReadonlySet<string>;
		fired?: ReadonlySet<string>;
	}
): FailureAccounting {
	const failures: string[] = [];
	const buckets = new Map<string, string[]>();
	const put = (site: string, bucket: string) =>
		buckets.set(site, [...(buckets.get(site) ?? []), bucket]);
	for (const f of ledger.fired) put(f.site, 'fired');
	for (const c of ledger.covered) put(c.site, 'covered');
	for (const i of ledger.impossible) put(i.site, 'impossible');
	for (const b of ledger.baseline) put(b, 'baseline');
	for (const s of sites) if (!buckets.has(s)) failures.push(`in no bucket: ${s}`);
	for (const [s, b] of buckets) {
		if (b.length > 1) failures.push(`in two buckets: ${s} (${b.join(', ')})`);
		if (!sites.has(s))
			failures.push(
				b.includes('baseline')
					? `no site has it (take it out of the baseline): ${s}`
					: `no site has it (the ledger names it): ${s}`
			);
	}
	const has_name = (text: string, name: string): boolean =>
		text.includes(`'${name}'`) || text.includes(`"${name}"`) || text.includes(`\`${name}\``);
	const build_time = new Set(ledger.scope.build_time ?? []);
	for (const f of ledger.fired) {
		const pkg = /^packages\/([^/]+)\//.exec(f.site)?.[1];
		if (pkg !== undefined && build_time.has(pkg))
			failures.push(`${f.site}: a build-time package's site is covered by a test, never fired`);
		const by = [f.point, f.fault, f.shape].filter((x) => x !== undefined).length;
		if (by !== 1) failures.push(`${f.site}: a fired site names one point, fault or shape`);
		else if (f.shape !== undefined && !o.shapes.has(f.shape))
			failures.push(`${f.site}: no app shape '${f.shape}' in gen.ts`);
		else if (f.point !== undefined && !o.points.has(f.point) && !o.app_points?.has(f.point))
			failures.push(`${f.site}: no buggify point '${f.point}' in the packages' source`);
		else if (f.fault !== undefined && (f.sim ?? 'app') === 'app' && !o.faults.has(f.fault))
			failures.push(`${f.site}: no sim fault '${f.fault}'`);
		else if (
			f.point !== undefined &&
			(f.sim ?? 'app') === 'app' &&
			o.fired !== undefined &&
			!o.fired.has(f.point)
		)
			failures.push(`${f.site}: its point '${f.point}' did not fire in the sweep`);
		if (f.killed_by !== undefined && !o.mutants.has(f.killed_by))
			failures.push(`${f.site}: no live mutant '${f.killed_by}' in mutants.json`);
	}
	for (const c of ledger.covered) {
		const text = o.read(c.test);
		if (text === null) failures.push(`${c.site}: its test file is not there: ${c.test}`);
		else if (!has_name(text, c.name)) failures.push(`${c.site}: ${c.test} has no test '${c.name}'`);
	}
	for (const i of ledger.impossible) {
		const text = o.read(i.by);
		if (text === null) failures.push(`${i.site}: its rule's file is not there: ${i.by}`);
		else if (!text.includes(i.name)) failures.push(`${i.site}: ${i.by} has no '${i.name}'`);
	}
	const named = new Set([
		...ledger.fired.flatMap((f) => (f.point === undefined ? [] : [f.point])),
		...(ledger.step_points ?? []).map((p) => p.point)
	]);
	for (const p of [...o.points].sort())
		if (!named.has(p)) failures.push(`an orphan point (no ledger entry names it): ${p}`);
	for (const p of ledger.step_points ?? []) {
		if (!o.points.has(p.point))
			failures.push(`no buggify point '${p.point}' in the packages' source (step_points)`);
		if (p.steps.length === 0) failures.push(`${p.point}: a step point names its steps`);
		if (p.killed_by !== undefined && !o.mutants.has(p.killed_by))
			failures.push(`${p.point}: no live mutant '${p.killed_by}' in mutants.json (step_points)`);
	}
	if (o.base !== undefined)
		for (const b of ledger.baseline)
			if (!o.base.has(b)) failures.push(`the baseline grew (put it in a bucket instead): ${b}`);
	const baseline = new Set(ledger.baseline);
	const accounted = [...sites].filter((s) => buckets.has(s) && !baseline.has(s)).length;
	const proved = ledger.fired.filter(
		(f) => f.killed_by !== undefined && o.mutants.has(f.killed_by)
	).length;
	return {
		accounted,
		total: sites.size,
		baseline: baseline.size,
		proved,
		failures
	};
}

/** The buggify points `source` asks: each `fires('<point>')`. */
export function points_in(source: string): string[] {
	return [...source.matchAll(/\bfires\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}

/** The random app's shapes: each stream gen.ts forks, `.fork('gen …')`. */
export function shapes_in(gen_source: string): string[] {
	return [...gen_source.matchAll(/\.fork\('(gen [^']+)'\)/g)].map((m) => m[1]);
}

/** The sim's fault classes, from network.ts's `FaultClass` union. */
export function faults_in(network_source: string): string[] {
	const at = network_source.indexOf('export type FaultClass');
	if (at === -1) return [];
	const body = network_source.slice(at, network_source.indexOf(';', at));
	return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// ── the check ───────────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const FAILURE_LEDGER = join(ROOT, 'internal', 'sim', 'failures.json');

export function read_failure_ledger(): FailureLedger {
	return JSON.parse(readFileSync(FAILURE_LEDGER, 'utf8')) as FailureLedger;
}

/** Every site of the ledger's scope. */
export function inventory(root: string, scope: Scope): Site[] {
	return scope_files(root, scope).flatMap((f) => sites_of(f, readFileSync(join(root, f), 'utf8')));
}

function arg(flag: string): string | undefined {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
}

function main(): void {
	const ledger = read_failure_ledger();
	const all = inventory(ROOT, ledger.scope);
	if (process.argv.includes('--list')) {
		const named = arg('--packages');
		const listed =
			named === undefined
				? all
				: inventory(ROOT, {
						packages: named.split(','),
						exclude: ledger.scope.exclude
					});
		for (const s of listed) console.log(`${s.file}:${s.line}  ${s.id}`);
		return;
	}
	const sites = new Set(all.map((s) => s.id));
	if (sites.size !== all.length) {
		const seen = new Set<string>();
		for (const s of all)
			if (seen.has(s.id)) console.log(`  two sites share an id: ${s.id}`);
			else seen.add(s.id);
		process.exitCode = 1;
		return;
	}
	if (process.argv.includes('--write-baseline')) {
		const bucketed = new Set([
			...ledger.fired.map((f) => f.site),
			...ledger.covered.map((c) => c.site),
			...ledger.impossible.map((i) => i.site)
		]);
		const baseline = all.map((s) => s.id).filter((s) => !bucketed.has(s));
		writeFileSync(FAILURE_LEDGER, `${JSON.stringify({ ...ledger, baseline }, null, '\t')}\n`);
		console.log(`wrote ${FAILURE_LEDGER}: ${baseline.length} in the baseline`);
		return;
	}
	const rev = arg('--base');
	let base: Set<string> | undefined;
	if (rev !== undefined) {
		try {
			const text = execFileSync('git', ['show', `${rev}:internal/sim/failures.json`], {
				cwd: ROOT,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore']
			});
			base = new Set((JSON.parse(text) as FailureLedger).baseline);
		} catch {
			console.log(`  (the base ${rev} has no failures.json: the baseline is not compared)`);
		}
	}
	const at = process.argv.indexOf('--sweep');
	const fired =
		at === -1
			? undefined
			: new Set(
					process.argv
						.slice(at + 1)
						.filter((a) => !a.startsWith('--'))
						.flatMap(fired_in)
				);
	const a = check_failures(ledger, sites, { base, fired });
	console.log(failures_line(ledger, a));
	for (const f of a.failures) console.log(`  ${f}`);
	if (a.failures.length > 0) process.exitCode = 1;
}

/** The ledger against the repo as it is: its sites (else the inventory's), the points the
 *  packages ask, the sim's faults, and mutants.json's live mutants. */
export function check_failures(
	ledger: FailureLedger,
	sites: ReadonlySet<string> = new Set(inventory(ROOT, ledger.scope).map((s) => s.id)),
	o: { base?: ReadonlySet<string>; fired?: ReadonlySet<string> } = {}
): FailureAccounting {
	const points = new Set(
		scope_files(ROOT, {
			packages: readdirSync(join(ROOT, 'packages')),
			exclude: []
		}).flatMap((f) => points_in(readFileSync(join(ROOT, f), 'utf8')))
	);
	const mutants = (
		JSON.parse(readFileSync(join(ROOT, 'internal/sim/mutants.json'), 'utf8')) as {
			id: string;
			equivalent?: string;
		}[]
	)
		.filter((m) => m.equivalent === undefined)
		.map((m) => m.id);
	return account_failures(sites, ledger, {
		read: (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null),
		points,
		faults: new Set(faults_in(readFileSync(join(ROOT, 'internal/sim/src/network.ts'), 'utf8'))),
		mutants: new Set(mutants),
		shapes: new Set(shapes_in(readFileSync(join(ROOT, 'internal/sim/src/gen.ts'), 'utf8'))),
		app_points: new Set(points_in(readFileSync(join(ROOT, 'internal/sim/src/gen.ts'), 'utf8'))),
		...o
	});
}

/** The check's summary line. */
export function failures_line(ledger: FailureLedger, a: FailureAccounting): string {
	const pct = Math.round((a.accounted / a.total) * 1000) / 10;
	return `failure sites accounted: ${a.accounted}/${a.total} (${pct}%), ${a.baseline} in the baseline (fired ${ledger.fired.length}, ${a.proved} with a killed mutant; covered ${ledger.covered.length}, impossible ${ledger.impossible.length})`;
}

/** The buggify points that fired in a results.json (its coverage's `points`). */
export function fired_in(results: string): string[] {
	const r = JSON.parse(readFileSync(results, 'utf8')) as {
		coverage?: { points?: { point: string; fired: number }[] };
	};
	return (r.coverage?.points ?? []).filter((p) => p.fired > 0).map((p) => p.point);
}

if (process.argv[1] === import.meta.filename) main();
