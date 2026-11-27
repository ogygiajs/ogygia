import type { AstNode } from './oxc.ts';

/** Calls `visit` on `node` and on every node below it, parents first, in source order. */
export function walk_ast(node: AstNode, visit: (n: AstNode) => void): void {
	visit(node);
	for (const key in node) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		const child = node[key];
		if (Array.isArray(child)) {
			for (const c of child)
				if (c && typeof c === 'object' && typeof c.type === 'string') walk_ast(c, visit);
		} else if (child && typeof child === 'object' && typeof child.type === 'string') {
			walk_ast(child, visit);
		}
	}
}

/** The 1-based line `offset` falls on in `src`. */
export function line_of(src: string, offset: number): number {
	let line = 1;
	const end = Math.min(offset, src.length);
	for (let i = src.indexOf('\n'); i !== -1 && i < end; i = src.indexOf('\n', i + 1)) line++;
	return line;
}

/** What {@link literal_of} returns for an expression that is not written out in place. */
export const NOT_LITERAL: unique symbol = Symbol('not literal');

/**
 * The value `n` writes when it is a literal: a string, number, boolean or `null`; a template with no
 * `${…}`; a signed number; `a / b` or `a * b` of numbers; an array or object literal of those (no
 * spreads, computed keys or methods); any of them wrapped in parentheses, `as` or `satisfies`.
 * Anything else (a name, a call, a regex, a bigint) is {@link NOT_LITERAL}.
 */
export function literal_of(n: AstNode): unknown {
	switch (n.type) {
		case 'Literal':
			return n.regex || n.bigint !== undefined ? NOT_LITERAL : n.value;
		case 'TemplateLiteral':
			return (n.expressions as AstNode[]).length === 0
				? (n.quasis as AstNode[]).map((q) => q.value.cooked).join('')
				: NOT_LITERAL;
		case 'UnaryExpression': {
			if (n.operator !== '-' && n.operator !== '+') return NOT_LITERAL;
			const v = literal_of(n.argument as AstNode);
			if (typeof v !== 'number') return NOT_LITERAL;
			return n.operator === '-' ? -v : v;
		}
		case 'BinaryExpression': {
			const l = literal_of(n.left as AstNode);
			const r = literal_of(n.right as AstNode);
			if (typeof l !== 'number' || typeof r !== 'number') return NOT_LITERAL;
			if (n.operator === '/') return l / r;
			if (n.operator === '*') return l * r;
			return NOT_LITERAL;
		}
		case 'ArrayExpression': {
			const out: unknown[] = [];
			for (const e of n.elements as (AstNode | null)[]) {
				if (!e || e.type === 'SpreadElement') return NOT_LITERAL;
				const v = literal_of(e);
				if (v === NOT_LITERAL) return NOT_LITERAL;
				out.push(v);
			}
			return out;
		}
		case 'ObjectExpression': {
			const out: Record<string, unknown> = {};
			for (const p of n.properties as AstNode[]) {
				if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method)
					return NOT_LITERAL;
				let key: string;
				if (p.key.type === 'Identifier') key = p.key.name as string;
				else if (typeof p.key.value === 'string') key = p.key.value as string;
				else return NOT_LITERAL;
				const v = literal_of(p.value as AstNode);
				if (v === NOT_LITERAL) return NOT_LITERAL;
				out[key] = v;
			}
			return out;
		}
		case 'TSAsExpression':
		case 'TSSatisfiesExpression':
		case 'ParenthesizedExpression':
			return literal_of(n.expression as AstNode);
		default:
			return NOT_LITERAL;
	}
}
