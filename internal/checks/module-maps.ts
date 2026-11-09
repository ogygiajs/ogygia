// NO UNBOUNDED, UNOWNED MODULE-LEVEL MAP OR SET (#414). A module-level `Map`, `Set` or growing
// array lives as long as the page or the server process. One that grows with requests, pages or
// visits, with no bound and no owner, is a leak. Each one in `packages/*/src` must be one of:
//
//   - a `cache()` (@ogygia/machine): bounded, owned, and it says what it lets go;
//   - owned by a scope, marked on the line before (or the same line): `// owned: <the scope, and
//     how it lets the entries go>`;
//   - a fixed table, filled once at load and never grown, marked `// static: <why it never grows>`.
//
// A mark with no reason does not count. `WeakMap` / `WeakSet` hold nothing alive and pass, as do
// maps made inside functions (they belong to the call). Parsed with oxc (`rolldown/utils`, as core's
// compiler parses).
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
	kind: 'Map' | 'Set' | 'array';
	fix: string;
};

const FIX =
	'make it a cache() (bounded, owned: @ogygia/machine), create it under the scope that owns it ' +
	"and mark it '// owned: <the scope>', or, for a fixed table never grown, mark it '// static: <why>'";

/** A `// static: <reason>` or `// owned: <reason>` mark with a reason. */
const MARK_RE = /^\s*(?:static|owned):\s*\S/;

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

/** The module-level maps, sets and growing arrays in `source` that are not a cache(), owned or
 *  marked fixed. */
export function find_unowned(file: string, source: string): Finding[] {
	const { program, comments } = parseSync(file, source);
	const line_of = (at: number): number => source.slice(0, at).split('\n').length;
	// each line's marks (a line comment on it)
	const marked = new Set<number>(); // (one per run of the check, not module-level)
	for (const c of comments)
		if (c.type === 'Line' && MARK_RE.test(c.value)) marked.add(line_of(c.start));
	const out: Finding[] = [];
	for (let s of program.body as Node[]) {
		if (s.type === 'ExportNamedDeclaration' && s.declaration) s = s.declaration as Node;
		if (s.type !== 'VariableDeclaration') continue;
		for (const d of s.declarations as Node[]) {
			const kind = grows(d.init as Node | null);
			if (kind === null) continue;
			const line = line_of(d.start);
			if (marked.has(line) || marked.has(line - 1) || marked.has(line_of(s.start) - 1)) continue;
			const id = d.id as Node;
			out.push({
				file,
				line,
				name: id.type === 'Identifier' ? String(id.name) : '(pattern)',
				kind,
				fix: FIX
			});
		}
	}
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
		console.log(`${f.file}:${f.line}  ${f.name}: a module-level ${f.kind}. Fix: ${f.fix}`);
	console.log(
		`${all.length} module-level map(s), set(s) or growing array(s) neither a cache(), owned, nor marked static` +
			(fail ? '' : ' (report mode: not failing; #413 sorts them, then this fails)')
	);
	if (fail && all.length) process.exit(1);
}
