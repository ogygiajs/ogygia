// NO EVAL IN WHAT SHIPS: every built JavaScript file (each package's dist/, each app's build output)
// is parsed (rolldown's parser, already in the repo) and refused when it turns a string into code:
// `eval(…)`, `Function(…)` / `new Function(…)`, or a string handed to `setTimeout` / `setInterval`.
// The source lint (.oxlintrc.json no-eval, no-new-func, no-implied-eval) covers what we write; this
// covers what we ship, bundled dependencies included. A page under a `'strict-dynamic'` CSP trusts
// our scripts, so one of these in them would run whatever string reached it.
// Fails naming each place, and fails when it finds no files (a scan of nothing is not a pass).
// Run by plain node in e2e.yml after the builds.
//
//   node .github/scripts/built-no-eval.ts [dir…]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

/** A place a built file turns a string into code. */
export interface EvalSite {
	file: string;
	line: number;
	what: string;
}

type Node = { type: string; start: number; [k: string]: unknown };

const TIMERS = new Set(['setTimeout', 'setInterval']);
const GLOBALS = new Set(['globalThis', 'window', 'self', 'global']);

/** `eval`, `globalThis.eval`, `window["eval"]`… : the name a callee reaches, when it is a global's. */
function global_name(n: Node | undefined): string | null {
	if (!n) return null;
	if (n.type === 'Identifier') return n.name as string;
	if (n.type === 'SequenceExpression') {
		const list = n.expressions as Node[];
		return global_name(list[list.length - 1]); // `(0, eval)(…)`
	}
	if (n.type === 'ParenthesizedExpression') return global_name(n.expression as Node);
	if (n.type === 'MemberExpression') {
		const obj = n.object as Node;
		if (obj.type !== 'Identifier' || !GLOBALS.has(obj.name as string)) return null;
		const prop = n.property as Node;
		if (!n.computed && prop.type === 'Identifier') return prop.name as string;
		if (n.computed && prop.type === 'Literal' && typeof prop.value === 'string') return prop.value;
	}
	return null;
}

const is_string = (n: Node | undefined): boolean =>
	!!n &&
	((n.type === 'Literal' && typeof n.value === 'string') ||
		n.type === 'TemplateLiteral' ||
		(n.type === 'BinaryExpression' &&
			n.operator === '+' &&
			(is_string(n.left as Node) || is_string(n.right as Node))));

/** Every place `code` turns a string into code. */
export function eval_sites(code: string, file: string): EvalSite[] {
	const out: EvalSite[] = [];
	const line_of = (at: number) => code.slice(0, at).split('\n').length;
	const walk = (n: unknown): void => {
		if (Array.isArray(n)) return n.forEach(walk);
		if (!n || typeof n !== 'object') return;
		const node = n as Node;
		if (node.type === 'CallExpression' || node.type === 'NewExpression') {
			const name = global_name(node.callee as Node);
			const args = node.arguments as Node[];
			if (name === 'eval' || name === 'Function')
				out.push({
					file,
					line: line_of(node.start),
					what: `${node.type === 'NewExpression' ? 'new ' : ''}${name}(…)`
				});
			else if (name && TIMERS.has(name) && is_string(args[0]))
				out.push({ file, line: line_of(node.start), what: `${name}(<string>)` });
		}
		for (const k in node) if (k !== 'type' && k !== 'start' && k !== 'end') walk(node[k]);
	};
	walk(parseAst(code, { sourceType: 'unambiguous' } as never, file));
	return out;
}

const JS_RE = /\.(?:m|c)?js$/;
const SKIP = new Set(['node_modules', '.vercel', '.netlify', '.wrangler']);

function* js_files(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) yield* js_files(p);
		else if (JS_RE.test(name)) yield p;
	}
}

/** The built output in this checkout: each package's dist/, each app's build output. */
function default_dirs(): string[] {
	const dirs: string[] = [];
	for (const [root, subs] of [
		['packages', ['dist']],
		['apps', ['build', '.svelte-kit/output']]
	] as const)
		for (const name of existsSync(root) ? readdirSync(root) : [])
			for (const sub of subs)
				if (existsSync(join(root, name, sub))) dirs.push(join(root, name, sub));
	return dirs;
}

// (run as a script, not imported by its test; `import.meta.main` is newer than CI's Node 22)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const dirs = process.argv.length > 2 ? process.argv.slice(2) : default_dirs();
	let files = 0;
	const found: EvalSite[] = [];
	for (const dir of dirs)
		for (const file of js_files(dir)) {
			files++;
			found.push(...eval_sites(readFileSync(file, 'utf8'), file));
		}
	if (files === 0) {
		console.error(
			`No built JavaScript found in: ${dirs.join(', ') || '(no build output)'}. Build first.`
		);
		process.exit(1);
	}
	if (found.length) {
		console.error(
			`Built code turns a string into code (a 'strict-dynamic' page would run it):\n` +
				found.map((s) => `  ${s.file}:${s.line}  ${s.what}`).join('\n')
		);
		process.exit(1);
	}
	console.log(`no eval in ${files} built file(s) under ${dirs.length} dir(s)`);
}
