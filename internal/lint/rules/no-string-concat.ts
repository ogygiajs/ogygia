/**
 * `ogygia/no-string-concat`: a string is built with a template literal, never with `+` / `+=`.
 * Read syntactically: a `+` chain fires when one of its operands is a string literal, a template
 * literal, a `.join()` or `String()` call, or such a chain itself; number arithmetic never does.
 * The fix writes the chain as one template literal (a number sum before the first string stays one
 * `${…}`, as `+` evaluates it). A chain across lines that builds lines of text (`\n`), or holds a
 * comment, is reported with the `dedent` hint and left for a hand fix. An append (`s += x`,
 * `s = s + x`, `s = \`${s}x\``) builds a string in pieces, and has no fix: in a loop body (a `for`,
 * `for…of`, `for…in`, `while` or `do`, or a `forEach` / `map` callback) that the string outlives,
 * it is reported with the `join` hint; elsewhere, with the hint to write the string once
 * (internal/lint/no-string-concat.test.ts).
 */

import { concat_kept, unwrap, type FixContext, type Node, type Ranged } from './shared.ts';

const MESSAGE_CONCAT = 'Build the string with a template literal, not `+`.';
const MESSAGE_CONCAT_LINES =
	'Build the string with a template literal, not `+` across lines: a long or multi-line one is a `dedent` template (core contract/dedent.ts).';

const MESSAGE_APPEND_LOOP =
	'A string appended to in a loop: collect the parts in an array and `join()` them once.';
const MESSAGE_APPEND =
	'Build the string once, in one template literal, not by appending to it (a part that is not always there is a `${…}` that can be empty).';

const LOOP_CALLBACKS: ReadonlySet<string> = new Set(['forEach', 'map']);
const FUNCTIONS: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression'
]);
const BLOCKS: ReadonlySet<string> = new Set(['BlockStatement', 'Program', 'StaticBlock']);

/** The names a binding pattern binds. */
function bound(p: Node | null | undefined): string[] {
	if (!p) return [];
	switch (p.type) {
		case 'Identifier':
			return [(p as { name: string }).name];
		case 'AssignmentPattern':
			return bound(p.left as Node);
		case 'RestElement':
			return bound(p.argument as Node);
		case 'ArrayPattern':
			return (p.elements as (Node | null)[]).flatMap(bound);
		case 'ObjectPattern':
			return (p.properties as Node[]).flatMap((q) =>
				bound(q.type === 'RestElement' ? q : (q.value as Node))
			);
		case 'TSParameterProperty':
			return bound(p.parameter as Node);
		default:
			return [];
	}
}

const declares = (d: Node | null | undefined, name: string): boolean =>
	d?.type === 'VariableDeclaration' &&
	(d.declarations as Node[]).some((v) => bound(v.id as Node).includes(name));

/** Is `fn` the callback of a `forEach` / `map` call? */
function loop_callback(fn: Node): boolean {
	const call = fn.parent as Node | undefined;
	if (call?.type !== 'CallExpression' || !(call.arguments as Node[]).includes(fn)) return false;
	const callee = call.callee as Node;
	return (
		callee.type === 'MemberExpression' &&
		LOOP_CALLBACKS.has((callee.property as { name?: string })?.name ?? '')
	);
}

/** Does the append `node` to `name` (a member's: its object's name; null: `this`) run on more than one turn of a loop that the
 *  string outlives? The walk goes up to where `name` is declared; a loop passed on the way counts. */
function across_turns(node: Node, name: string | null): boolean {
	let looped = false;
	let child = node;
	let n = node.parent as Node | undefined;
	while (n) {
		switch (n.type) {
			case 'ForOfStatement':
			case 'ForInStatement':
				if (name !== null && declares(n.left as Node, name)) return looped;
				if (n.body === child) looped = true;
				break;
			case 'ForStatement':
				if (n.body === child || n.update === child) looped = true;
				if (name !== null && declares(n.init as Node, name)) return looped;
				break;
			case 'WhileStatement':
			case 'DoWhileStatement':
				if (n.body === child) looped = true;
				break;
			case 'SwitchCase':
				if (name !== null && (n.consequent as Node[]).some((s) => declares(s, name))) return looped;
				break;
			default:
				if (BLOCKS.has(n.type)) {
					if (name !== null && (n.body as Node[]).some((s) => declares(s, name))) return looped;
				} else if (FUNCTIONS.has(n.type)) {
					if (name !== null && (n.params as Node[]).some((p) => bound(p).includes(name)))
						return looped;
					if (!loop_callback(n)) return looped;
					looped = true;
				}
		}
		child = n;
		n = n.parent as Node | undefined;
	}
	return looped;
}

const is_plus = (e: Node | undefined): boolean =>
	e?.type === 'BinaryExpression' && e.operator === '+';

/** The operands of a left-leaning `+` chain, in order. */
function operands(e: Node): Node[] {
	const out: Node[] = [];
	let n = e;
	while (is_plus(n)) {
		out.push(n.right as Node);
		n = n.left as Node;
	}
	out.push(n);
	return out.reverse();
}

/** A string by its shape (see the rule's comment). */
function stringy(e: Node): boolean {
	const n = unwrap(e);
	if (n.type === 'Literal') return typeof n.value === 'string';
	if (n.type === 'TemplateLiteral') return true;
	if (n.type === 'CallExpression') {
		const callee = n.callee as Node;
		if (callee.type === 'Identifier') return (callee as { name?: string }).name === 'String';
		if (callee.type === 'MemberExpression')
			return (callee.property as { name?: string })?.name === 'join';
		return false;
	}
	if (is_plus(n)) return operands(n).some(stringy);
	return false;
}

/** `raw` (a string literal's text between its quotes) as template literal text. */
const as_template_text = (raw: string): string =>
	raw.replace(/\\[\s\S]|`|\$\{/g, (m) => (m === '`' ? '\\`' : m === '${' ? '\\${' : m));

/** One operand's part of the template. */
function part(context: FixContext, e: Node): string {
	const n = unwrap(e);
	const text = context.sourceCode.getText(n as Ranged);
	if (n.type === 'Literal' && typeof n.value === 'string')
		return as_template_text(text.slice(1, -1));
	if (n.type === 'TemplateLiteral') return text.slice(1, -1);
	// (a string chain in parentheses joins this one's template)
	if (is_plus(n) && stringy(n)) return as_template(context, n, operands(n)).slice(1, -1);
	return `\${${context.sourceCode.getText(e as Ranged)}}`;
}

/** The chain `ops` (whose top node is `top`) as one template literal. */
function as_template(context: FixContext, top: Node, ops: Node[]): string {
	const first = ops.findIndex(stringy);
	const parts: string[] = [];
	if (first > 0) {
		// the operands before the first string, as `+` adds them: one `${…}`
		let prefix = top;
		for (let i = ops.length - 1; i >= first; i--) prefix = prefix.left as Node;
		parts.push(`\${${context.sourceCode.getText(prefix as Ranged)}}`);
	}
	for (let i = Math.max(first, 0); i < ops.length; i++) parts.push(part(context, ops[i]!));
	const out = parts.join('');
	// ('</' + 'script>' is split on purpose: in a .svelte or HTML script block a whole one closes it;
	// `\x3C` keeps it whole as a value, and no-useless-escape leaves a hex escape be)
	return `\`${out.replace(CLOSE_SCRIPT_G, '\\x3C/$1')}\``;
}

const CLOSE_SCRIPT_G = /<\/(script)/gi;

/** The target's text when the assignment `node` appends a string to it (`s += 'x'`,
 *  `s = s + 'x'`, `s = \`${s}x\``), else null. */
function appended(context: FixContext, node: Node): string | null {
	const left = node.left as Node;
	if (left.type !== 'Identifier' && left.type !== 'MemberExpression') return null;
	const right = unwrap(node.right as Node);
	if (node.operator === '+=')
		return stringy(right) ? context.sourceCode.getText(left as Ranged) : null;
	if (node.operator !== '=') return null;
	const target = context.sourceCode.getText(left as Ranged);
	const is_target = (e: Node | undefined) =>
		e !== undefined && context.sourceCode.getText(unwrap(e) as Ranged) === target;
	if (right.type === 'TemplateLiteral') {
		const quasis = right.quasis as { value: { raw: string } }[];
		const values = right.expressions as Node[];
		const first = quasis[0]!.value.raw === '' && is_target(values[0]);
		return first && (values.length > 1 || quasis[1]!.value.raw !== '') ? target : null;
	}
	return is_plus(right) && stringy(right) && is_target(operands(right)[0]) ? target : null;
}

export const no_string_concat = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		docs: { description: 'Strings are built with template literals, never with `+`.' }
	},
	create(context: FixContext) {
		const across_lines = (n: Ranged) => n.loc.start.line !== n.loc.end.line;
		// (a chain across lines joins onto one when it builds one line of text; one that builds lines,
		// or holds a comment, is a hand fix: a `dedent` template)
		const fixable = (n: Ranged) =>
			context.sourceCode.getCommentsInside(n).length === 0 &&
			(!across_lines(n) || !/\\n/.test(context.sourceCode.getText(n)));
		return {
			BinaryExpression(node: Node) {
				if (node.operator !== '+') return;
				// the chain's top only: a `+` whose parent adds it on the right is checked there
				// (or, in parentheses, in the chain that holds it)
				const parent = node.parent as Node | undefined;
				if (is_plus(parent)) return;
				if (parent?.type === 'AssignmentExpression' && appended(context, parent) !== null) return;
				const ops = operands(node);
				if (!ops.some(stringy) || concat_kept(node)) return;
				const n = node as Ranged;
				if (!fixable(n)) {
					context.report({
						node,
						message: across_lines(n) ? MESSAGE_CONCAT_LINES : MESSAGE_CONCAT
					});
					return;
				}
				context.report({
					node,
					message: MESSAGE_CONCAT,
					fix: (fixer) => fixer.replaceText(n, as_template(context, node, ops))
				});
			},
			AssignmentExpression(node: Node) {
				const target = appended(context, node);
				if (target === null || concat_kept(node)) return;
				let root = node.left as Node;
				while (root.type === 'MemberExpression') root = root.object as Node;
				const name = root.type === 'Identifier' ? (root as { name: string }).name : null;
				context.report({
					node,
					message: across_turns(node, name) ? MESSAGE_APPEND_LOOP : MESSAGE_APPEND
				});
			}
		};
	}
};
