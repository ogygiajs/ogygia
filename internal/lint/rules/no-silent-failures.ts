import {
	in_source,
	ok_lines,
	OK_NOTE,
	reason_notes,
	type Context,
	type Located,
	type Node
} from './shared.ts';

/** A value handed back in place of what failed: a literal (`null`, `''`, `0`, `false`), a template
 *  with nothing in it, `[]`, `{}`, `void 0`, `-1`, or a plain name (`undefined`, a fallback
 *  constant). */
function is_fallback(e: Node | undefined | null): boolean {
	if (!e) return true;
	switch (e.type) {
		case 'Literal':
		case 'Identifier':
			return true;
		case 'TemplateLiteral':
			return (e.expressions as unknown[]).length === 0;
		case 'ArrayExpression':
			return (e.elements as unknown[]).length === 0;
		case 'ObjectExpression':
			return (e.properties as unknown[]).length === 0;
		case 'UnaryExpression':
			return (e.argument as Node).type === 'Literal';
		default:
			return false;
	}
}

/** A body that does nothing with the failure but fall back: empty, or one `return <fallback>`,
 *  `continue`, `break`, or `<name> = <fallback>`. */
function falls_back(statements: unknown[]): boolean {
	if (statements.length === 0) return true;
	if (statements.length > 1) return false;
	const s = statements[0] as Node;
	if (s.type === 'ReturnStatement') return is_fallback(s.argument as Node | null);
	if (s.type === 'ContinueStatement' || s.type === 'BreakStatement') return true;
	if (s.type !== 'ExpressionStatement') return false;
	const e = s.expression as Node;
	return (
		e.type === 'AssignmentExpression' &&
		(e.left as Node).type === 'Identifier' &&
		is_fallback(e.right as Node)
	);
}

/** Does `node` read the name `name` anywhere under it? */
function reads(node: unknown, name: string): boolean {
	if (!node || typeof node !== 'object') return false;
	if (Array.isArray(node)) return node.some((n) => reads(n, name));
	const n = node as Node;
	if (n.type === 'Identifier' && (n as { name?: string }).name === name) return true;
	for (const key in n) {
		if (key === 'parent' || key === 'loc' || key === 'range') continue;
		if (reads((n as Record<string, unknown>)[key], name)) return true;
	}
	return false;
}

/** A handler that does nothing with the failure but fall back: `() => {}`, `() => null`,
 *  `() => ''`, `() => []`, `() => { return false; }`, or a function named `noop`. One that reads
 *  its error does something with it. */
function swallows(handler: unknown): boolean {
	const h = handler as Node | undefined;
	if (!h) return false;
	if (h.type === 'Identifier') return (h as { name?: string }).name === 'noop';
	if (h.type !== 'ArrowFunctionExpression' && h.type !== 'FunctionExpression') return false;
	const param = (h.params as Node[])[0];
	if (param?.type === 'Identifier' && reads(h.body, (param as { name: string }).name)) return false;
	const body = h.body as Node;
	if (body.type === 'BlockStatement') return falls_back(body.body as unknown[]);
	return is_fallback(body);
}

/** A `catch` that does nothing with the failure but fall back (it never reads its error). */
function catch_falls_back(clause: Node): boolean {
	const statements = (clause.body as Node).body as unknown[];
	if (!falls_back(statements)) return false;
	const param = clause.param as Node | null;
	return !(param?.type === 'Identifier' && reads(statements, (param as { name: string }).name));
}

/** `p.catch(handler)` / `p.then(ok, handler)`: the failure has a handler that does something. */
function handled(call: Node): boolean {
	const callee = call.callee as Node;
	if (callee?.type !== 'MemberExpression') return false;
	const name = (callee.property as { name?: string }).name;
	const args = call.arguments as unknown[];
	if (name === 'catch') return args.length > 0 && !swallows(args[0]);
	if (name === 'then') return args.length > 1 && !swallows(args[1]);
	return false;
}

const MESSAGE_SILENT =
	'A failure swallowed with no word: report it (a message code), re-throw it, or move a machine. One that is truly fine says why on the same line: `// ok: <reason>`.';

/**
 * `ogygia/no-silent-failures`: every caught failure reports a message code, re-throws, or moves a
 * machine; nothing is swallowed without a written reason. Refused: a `catch` that only falls back
 * (empty, or one `return <fallback>`, `continue`, `break` or `x = <fallback>`, never reading its
 * error; a comment is not a body), a handler that only falls back (`.catch(() => {})`, `=> null`,
 * `=> ''`, `=> []`, `noop`; #1286), and a bare `void <call>()`,
 * whose rejection goes unhandled unless the callee catches it (`void p.catch(report)` is handled).
 * A site that is truly fine carries `// ok: <reason>` on its first or last line (for a catch, also
 * inside its body; for a `void` call, also alone on the line above). A `void` call is one through
 * an optional chain or a cast too (`void s?.send?.()`); an awaited one (`void (await p())`) is not.
 */
export const no_silent_failures = {
	meta: {
		type: 'problem',
		docs: {
			description: 'A caught failure reports, re-throws or moves a machine, or says why not.'
		}
	},
	create(context: Context) {
		if (!in_source(context)) return {};
		let ok: Set<number> | null = null;
		let noted: ((node: Node) => boolean) | null = null;
		const marked = (node: Node): boolean => {
			const n = node as Located;
			ok ??= ok_lines(context);
			for (let line = n.loc.start.line; line <= n.loc.end.line; line++) {
				// (first and last line; a catch also inside its body)
				if (line !== n.loc.start.line && line !== n.loc.end.line && n.type !== 'CatchClause')
					continue;
				if (ok.has(line)) return true;
			}
			return false;
		};
		const refuse = (node: Node) => {
			if (!marked(node)) context.report({ node, message: MESSAGE_SILENT });
		};
		return {
			CatchClause(node: Node) {
				if (catch_falls_back(node)) refuse(node);
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				if (callee?.type !== 'MemberExpression') return;
				const name = (callee.property as { name?: string }).name;
				const args = node.arguments as unknown[];
				if (name === 'catch' && swallows(args[0])) refuse(node);
				else if (name === 'then' && args.length > 1 && swallows(args[1])) refuse(node);
			},
			UnaryExpression(node: Node) {
				if (node.operator !== 'void') return;
				// (an optional call `s?.send?.()` and a cast `(p() as T)` are calls too; an awaited one,
				// `void (await p())`, is handled by its await)
				let arg = node.argument as Node | undefined;
				while (
					arg?.type === 'ParenthesizedExpression' ||
					arg?.type === 'TSAsExpression' ||
					arg?.type === 'TSNonNullExpression' ||
					arg?.type === 'ChainExpression'
				)
					arg = arg.expression as Node;
				// (`void p.catch(() => {})` is the `.catch` site's, said once there)
				if (arg?.type !== 'CallExpression' || handled(arg) || swallowing_chain(arg)) return;
				// (a note on the call's own line, or alone on the line above: reason-notes.test.ts)
				noted ??= reason_notes(context, OK_NOTE);
				if (!noted(node) && !marked(node)) context.report({ node, message: MESSAGE_SILENT });
			}
		};
	}
};

/** `p.catch(<swallow>)` or `p.then(a, <swallow>)`: reported as a `.catch` site already. */
function swallowing_chain(call: Node): boolean {
	const callee = call.callee as Node;
	if (callee?.type !== 'MemberExpression') return false;
	const name = (callee.property as { name?: string }).name;
	const args = call.arguments as unknown[];
	return (name === 'catch' && swallows(args[0])) || (name === 'then' && swallows(args[1]));
}
