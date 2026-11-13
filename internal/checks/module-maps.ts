// NO UNBOUNDED, UNOWNED MODULE-LEVEL MAP OR SET (#414). A module-level `Map`, `Set` or growing
// array lives as long as the page or the server process. One that grows with requests, pages or
// visits, with no bound and no owner, is a leak. At module level, each one in `packages/*/src` is
// one of three forms:
//
//   - a `cache()` (@ogygia/machine): bounded, owned, and it says what it lets go. Its bound is a
//     number: a literal `max: Infinity` is refused anywhere in the module;
//   - a `registry()` or `registry.keyed()` (@ogygia/machine): live entries, each owned by a scope
//     and gone with it, never evicted (watchers, modules, definitions);
//   - a fixed table, filled by its initializer and never grown, marked by its TYPE: `ReadonlySet<…>`,
//     `ReadonlyMap<…>`, `ReadonlyArray<…>` / `readonly T[]`, or `as const`. tsc then refuses a mutation
//     from any module; this check also refuses a `.set` / `.add` / `.push` / `.unshift` / `.splice`
//     on it, or a write to an index of it, in its own module. (The older mark, `// static: <why>` on
//     its line or the line before, still counts until every one moves to the type.)
//
// All are `const`: a module-level `let` holding a collection is growth (it is reassigned:
// `x = [...x, o]`, `x = new Map(x)`, `x ||= …`), marked or not.
//
// One owned by a scope does not live at module level: it is made inside its owner (the scope's
// function, the class), which this check does not flag. A comment claiming ownership is no pass.
// A mark with no reason does not count. `WeakMap` / `WeakSet` hold nothing alive and pass. Parsed
// with oxc (`rolldown/utils`, as core's compiler parses).
//
//   node internal/checks/module-maps.ts          name each offender, failing when there is one
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Node = Record<string, unknown> & { type: string; start: number; end: number };
type Parse = (
	id: string,
	code: string
) => { program: Node; comments: { type: string; value: string; start: number; end: number }[] };

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { parseSync } = createRequire(path.join(repo, 'packages/core/package.json'))(
	'rolldown/utils'
) as { parseSync: Parse };

export type Finding = {
	file: string;
	line: number;
	name: string;
	/** What it is: an unowned Map / Set / growing array, or a static table the module grows. */
	kind: 'Map' | 'Set' | 'array' | 'static-grown' | 'let' | 'infinite-max';
	fix: string;
};

const FIX = `make it a cache() (bounded, owned: @ogygia/machine), move it into its owner (made inside the scope, function or class that owns it), or, for a fixed table never grown, type it readonly (ReadonlySet, ReadonlyMap, readonly T[], as const)`;

const FIX_GROWN = `a fixed (readonly or '// static:') table is never grown after its initializer: make it a cache(), or move it into its owner`;

const FIX_LET = `a module-level let holding a collection grows by reassignment (x = [...x, o], new Map(x), x.concat(...)): make it a const cache(), move it into its owner, or, for a fixed table, a const typed readonly (ReadonlySet, ReadonlyMap, readonly T[], as const)`;

/** A module-level initializer that holds a collection: an array literal, or a new Map / Set. */
function is_collection(init: Node | null | undefined): boolean {
	if (!init) return false;
	if (init.type === 'ArrayExpression') return true;
	return grows(init) !== null;
}

/** A `// static: <reason>` mark with a reason (the older mark: the readonly type replaces it). */
const MARK_RE = /^\s*static:\s*\S/;

const READONLY_NAMES: ReadonlySet<string> = new Set([
	'ReadonlySet',
	'ReadonlyMap',
	'ReadonlyArray'
]);

/** A type that refuses every mutation in tsc: `ReadonlySet<…>`, `ReadonlyMap<…>`,
 *  `ReadonlyArray<…>`, `readonly T[]`, or `const` (`as const`). */
function is_readonly_type(t: Node | null | undefined): boolean {
	if (!t) return false;
	if (t.type === 'TSTypeAnnotation') return is_readonly_type(t.typeAnnotation as Node);
	if (t.type === 'TSTypeOperator') return t.operator === 'readonly';
	if (t.type !== 'TSTypeReference') return false;
	const name = t.typeName as Node;
	return (
		name.type === 'Identifier' && (READONLY_NAMES.has(String(name.name)) || name.name === 'const')
	);
}

/** A declaration whose type is a readonly one: its annotation, or its initializer's `as` / `satisfies`. */
function typed_readonly(d: Node): boolean {
	if (is_readonly_type((d.id as Node).typeAnnotation as Node | null)) return true;
	const init = d.init as Node | null;
	return (
		!!init &&
		(init.type === 'TSAsExpression' || init.type === 'TSSatisfiesExpression') &&
		is_readonly_type(init.typeAnnotation as Node)
	);
}

/** The calls that grow a Map, Set or array. */
const GROWING_CALLS = new Set(['set', 'add', 'push', 'unshift', 'splice']); // static: five method names

/** Each place in `program` that grows a binding named in `names`: a growing call on it, or a write to
 *  an index of it. */
function writes_to(program: Node, names: ReadonlySet<string>): Array<{ name: string; at: number }> {
	const out: Array<{ name: string; at: number }> = [];
	const named = (n: unknown): string | null =>
		n && (n as Node).type === 'Identifier' && names.has(String((n as Node).name))
			? String((n as Node).name)
			: null;
	const walk = (n: unknown): void => {
		if (!n || typeof n !== 'object') return;
		const node = n as Node;
		if (node.type === 'CallExpression') {
			const callee = node.callee as Node;
			const target = callee.type === 'MemberExpression' ? named(callee.object) : null;
			const method =
				callee.type === 'MemberExpression' && !callee.computed
					? String((callee.property as Node).name)
					: '';
			if (target && GROWING_CALLS.has(method)) out.push({ name: target, at: node.start });
		} else if (node.type === 'AssignmentExpression') {
			const left = node.left as Node;
			const target = left.type === 'MemberExpression' && left.computed ? named(left.object) : null;
			if (target) out.push({ name: target, at: node.start });
		}
		for (const key in node) {
			if (key === 'type' || key === 'start' || key === 'end') continue;
			const v = node[key];
			if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === 'object') walk(v);
		}
	};
	walk(program);
	return out;
}

/** What a module-level initializer grows, found outside any function inside it; `null` when nothing. */
function grows(init: Node | null | undefined): Finding['kind'] | null {
	if (!init) return null;
	if (init.type === 'ArrayExpression' && (init.elements as unknown[]).length === 0) return 'array';
	let found: Finding['kind'] | null = null;
	const walk = (n: unknown): void => {
		if (found || !n || typeof n !== 'object') return;
		const node = n as Node;
		if (
			node.type === 'ArrowFunctionExpression' ||
			node.type === 'FunctionExpression' ||
			node.type === 'ClassExpression'
		)
			return;
		if (
			node.type === 'NewExpression' &&
			(node.callee as Node).type === 'Identifier' &&
			((node.callee as Node).name === 'Map' || (node.callee as Node).name === 'Set')
		) {
			found = (node.callee as Node).name as 'Map' | 'Set';
			return;
		}
		// (a cache() is the bounded form: what it is given is its own)
		if (
			node.type === 'CallExpression' &&
			(node.callee as Node).type === 'Identifier' &&
			(node.callee as Node).name === 'cache'
		)
			return;
		for (const key in node) {
			if (key === 'type' || key === 'start' || key === 'end') continue;
			const v = node[key];
			if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === 'object') walk(v);
		}
	};
	walk(init);
	return found;
}

/** The module-level maps, sets and growing arrays in `source` that are neither a cache() nor a
 *  marked fixed table, and each marked fixed table the module grows (by its write). */
export function find_unowned(file: string, source: string): Finding[] {
	const { program, comments } = parseSync(file, source);
	const line_of = (at: number): number => source.slice(0, at).split('\n').length;
	// each line's marks (a line comment on it), and the lines whose mark stands alone (nothing
	// before it on its line): only those mark the declaration on the line after
	const marked = new Set<number>(); // (one per run of the check, not module-level)
	const alone = new Set<number>(); // (same)
	for (const c of comments) {
		if (c.type !== 'Line' || !MARK_RE.test(c.value)) continue;
		const line = line_of(c.start);
		marked.add(line);
		if (source.slice(source.lastIndexOf('\n', c.start - 1) + 1, c.start).trim() === '')
			alone.add(line);
	}
	const out: Finding[] = [];
	// the marked fixed tables, by name: the module must never grow them
	const statics = new Set<string>(); // (one per file the check reads, not module-level)
	for (let s of program.body as Node[]) {
		if (s.type === 'ExportNamedDeclaration' && s.declaration) s = s.declaration as Node;
		if (s.type !== 'VariableDeclaration') continue;
		for (const d of s.declarations as Node[]) {
			const line = line_of(d.start);
			const id = d.id as Node;
			const name = id.type === 'Identifier' ? String(id.name) : '(pattern)';
			// a let is reassigned: a collection in one grows, marked or not (a static table is const)
			if (s.kind === 'let' && is_collection(d.init as Node | null)) {
				out.push({ file, line, name, kind: 'let', fix: FIX_LET });
				continue;
			}
			const kind = grows(d.init as Node | null);
			if (kind === null) continue;
			if (
				typed_readonly(d) ||
				marked.has(line) ||
				alone.has(line - 1) ||
				alone.has(line_of(s.start) - 1)
			) {
				statics.add(name);
				continue;
			}
			out.push({ file, line, name, kind, fix: FIX });
		}
	}
	if (statics.size)
		for (const w of writes_to(program, statics))
			out.push({ file, line: line_of(w.at), name: w.name, kind: 'static-grown', fix: FIX_GROWN });
	for (const at of infinite_maxes(program))
		out.push({ file, line: line_of(at), name: 'max', kind: 'infinite-max', fix: FIX_MAX });
	return out;
}

const FIX_MAX =
	'a bound is a finite number: give the cache or flights the most it may keep (Infinity is no bound)';

/** Each `max: Infinity` property in `program`: where it starts. */
function infinite_maxes(program: Node): number[] {
	const out: number[] = [];
	const walk = (n: unknown): void => {
		if (!n || typeof n !== 'object') return;
		const node = n as Node;
		if (
			node.type === 'Property' &&
			!node.computed &&
			(node.key as Node).type === 'Identifier' &&
			(node.key as Node).name === 'max' &&
			(node.value as Node).type === 'Identifier' &&
			(node.value as Node).name === 'Infinity'
		)
			out.push(node.start);
		for (const key in node) {
			if (key === 'type' || key === 'start' || key === 'end') continue;
			const v = node[key];
			if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === 'object') walk(v);
		}
	};
	walk(program);
	return out;
}

/** Every `.ts` source file under `packages/<pkg>/src`. */
function sources(): string[] {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(p);
		}
	};
	for (const pkg of readdirSync(path.join(repo, 'packages'), { withFileTypes: true })) {
		if (!pkg.isDirectory()) continue;
		const src = path.join(repo, 'packages', pkg.name, 'src');
		try {
			walk(src);
		} catch {
			// ok: a package with no src folder has nothing to check
		}
	}
	return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const all: Finding[] = [];
	for (const file of sources())
		all.push(...find_unowned(path.relative(repo, file), readFileSync(file, 'utf8')));
	for (const f of all)
		console.log(
			f.kind === 'static-grown'
				? `${f.file}:${f.line}  ${f.name}: a static table grown here. Fix: ${f.fix}`
				: `${f.file}:${f.line}  ${f.name}: a module-level ${f.kind}. Fix: ${f.fix}`
		);
	console.log(
		`${all.length} finding(s): module-level maps, sets or growing arrays neither a cache() nor a fixed table, and fixed tables grown`
	);
	if (all.length) process.exit(1);
}
