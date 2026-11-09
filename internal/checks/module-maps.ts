// NO UNBOUNDED, UNOWNED MODULE-LEVEL MAP OR SET (#414). A module-level `Map`, `Set` or growing
// array lives as long as the page or the server process. One that grows with requests, pages or
// visits, with no bound and no owner, is a leak. At module level, each one in `packages/*/src` is
// one of two forms:
//
//   - a `cache()` (@ogygia/machine): bounded, owned, and it says what it lets go;
//   - a fixed table, filled by its initializer and never grown, marked `// static: <why>` (on its
//     line or the line before). The check proves the "never grown": a `.set` / `.add` / `.push` /
//     `.unshift` / `.splice` on it, or a write to an index of it, anywhere in the module, is an error.
//
// Both are `const`: a module-level `let` holding a collection is growth (it is reassigned:
// `x = [...x, o]`, `x = new Map(x)`, `x ||= …`), marked or not.
//
// One owned by a scope does not live at module level: it is made inside its owner (the scope's
// function, the class), which this check does not flag. A comment claiming ownership is no pass.
// A mark with no reason does not count. `WeakMap` / `WeakSet` hold nothing alive and pass. Parsed
// with oxc (`rolldown/utils`, as core's compiler parses).
//
//   node internal/checks/module-maps.ts          report each offender (exit 0)
//   node internal/checks/module-maps.ts --fail   the same, failing when there is one
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
	kind: 'Map' | 'Set' | 'array' | 'static-grown' | 'let';
	fix: string;
};

const FIX =
	'make it a cache() (bounded, owned: @ogygia/machine), move it into its owner (made inside the ' +
	"scope, function or class that owns it), or, for a fixed table never grown, mark it '// static: <why>'";

const FIX_GROWN =
	"a '// static:' table is never grown after its initializer: make it a cache(), or move it into " +
	'its owner';

const FIX_LET =
	'a module-level let holding a collection grows by reassignment (x = [...x, o], new Map(x), ' +
	"x.concat(...)): make it a const cache(), move it into its owner, or, for a fixed table, a const '// static: <why>'";

/** A module-level initializer that holds a collection: an array literal, or a new Map / Set. */
function is_collection(init: Node | null | undefined): boolean {
	if (!init) return false;
	if (init.type === 'ArrayExpression') return true;
	return grows(init) !== null;
}

/** A `// static: <reason>` mark with a reason. */
const MARK_RE = /^\s*static:\s*\S/;

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
	// each line's marks (a line comment on it)
	const marked = new Set<number>(); // (one per run of the check, not module-level)
	for (const c of comments)
		if (c.type === 'Line' && MARK_RE.test(c.value)) marked.add(line_of(c.start));
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
			if (marked.has(line) || marked.has(line - 1) || marked.has(line_of(s.start) - 1)) {
				statics.add(name);
				continue;
			}
			out.push({ file, line, name, kind, fix: FIX });
		}
	}
	if (statics.size)
		for (const w of writes_to(program, statics))
			out.push({ file, line: line_of(w.at), name: w.name, kind: 'static-grown', fix: FIX_GROWN });
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
	const fail = process.argv.includes('--fail');
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
		`${all.length} finding(s): module-level maps, sets or growing arrays neither a cache() nor a fixed table, and fixed tables grown` +
			(fail ? '' : ' (report mode: not failing; #413 sorts them, then this fails)')
	);
	if (fail && all.length) process.exit(1);
}
