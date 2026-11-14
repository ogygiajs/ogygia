/**
 * `ogygia/no-string-concat`: a string is built with a template literal, never with `+` / `+=`.
 * Read syntactically: a `+` chain fires when one of its operands is a string literal, a template
 * literal, a `.join()` or `String()` call, or such a chain itself; number arithmetic never does.
 * The fix writes the chain as one template literal (a number sum before the first string stays one
 * `${…}`, as `+` evaluates it). A chain across lines that builds lines of text (`\n`), or holds a
 * comment, is reported with the `dedent` hint and left for a hand fix. A `+=` in a loop body (a
 * `for`, `for…of`, `for…in`, `while` or `do`, or a `forEach` / `map` callback) builds a string in
 * pieces: it is reported with the `join` hint and no fix (internal/lint/no-string-concat.test.ts).
 */

import { concat_kept, unwrap, type FixContext, type Node, type Ranged } from './shared.ts';

const MESSAGE_CONCAT = 'Build the string with a template literal, not `+`.';
const MESSAGE_CONCAT_LINES =
	'Build the string with a template literal, not `+` across lines: a long or multi-line one is a `dedent` template (core contract/dedent.ts).';

const MESSAGE_CONCAT_LOOP =
	'A string built with `+=` in a loop: collect the parts in an array and `join()` them once.';

const LOOPS: ReadonlySet<string> = new Set([
	'ForStatement',
	'ForOfStatement',
	'ForInStatement',
	'WhileStatement',
	'DoWhileStatement'
]);
const LOOP_CALLBACKS: ReadonlySet<string> = new Set(['forEach', 'map']);
const FUNCTIONS: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression'
]);

/** Is `node` in a loop's body, or in a `forEach` / `map` callback, within its own function? */
function in_loop(node: Node): boolean {
	let child = node;
	let n = node.parent as Node | undefined;
	while (n) {
		if (LOOPS.has(n.type) && n.body === child) return true;
		if (FUNCTIONS.has(n.type)) {
			const call = n.parent as Node | undefined;
			if (call?.type !== 'CallExpression' || !(call.arguments as Node[]).includes(n)) return false;
			const callee = call.callee as Node;
			return (
				callee.type === 'MemberExpression' &&
				LOOP_CALLBACKS.has((callee.property as { name?: string })?.name ?? '')
			);
		}
		child = n;
		n = n.parent as Node | undefined;
	}
	return false;
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
	let out = '';
	if (first > 0) {
		// the operands before the first string, as `+` adds them: one `${…}`
		let prefix = top;
		for (let i = ops.length - 1; i >= first; i--) prefix = prefix.left as Node;
		out = `${out}\${${context.sourceCode.getText(prefix as Ranged)}}`;
	}
	for (let i = Math.max(first, 0); i < ops.length; i++) out += part(context, ops[i]!);
	// ('</' + 'script>' is split on purpose: in a .svelte or HTML script block a whole one closes it;
	// `\x3C` keeps it whole as a value, and no-useless-escape leaves a hex escape be)
	return `\`${out.replace(CLOSE_SCRIPT_G, '\\x3C/$1')}\``;
}

const CLOSE_SCRIPT_G = /<\/(script)/gi;

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
				if (node.operator !== '+=' || !stringy(node.right as Node) || concat_kept(node)) return;
				const left = node.left as Node;
				const n = node as Ranged;
				if (in_loop(node)) {
					context.report({ node, message: MESSAGE_CONCAT_LOOP });
					return;
				}
				// (a plain name only: a member read twice could run a getter twice)
				const simple = left.type === 'Identifier' && !is_plus(unwrap(node.right as Node));
				if (!simple || !fixable(n)) {
					context.report({
						node,
						message: across_lines(n) ? MESSAGE_CONCAT_LINES : MESSAGE_CONCAT
					});
					return;
				}
				const name = context.sourceCode.getText(left as Ranged);
				context.report({
					node,
					message: MESSAGE_CONCAT,
					fix: (fixer) =>
						fixer.replaceText(n, `${name} = \`\${${name}}${part(context, node.right as Node)}\``)
				});
			}
		};
	}
};
