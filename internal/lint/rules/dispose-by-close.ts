// ── ogygia/dispose-by-close ───────────────────────────────────────────────
// Package source never calls `x[Symbol.dispose]()` / `x[Symbol.asyncDispose]()`: WebKit has neither
// symbol, so the call is `x[undefined]()` and throws (#1144). A scope closes with `close()`.
// Defining the method is fine (machine keys it with a fallback symbol): only calls are refused.

import { in_source, type Context, type Node } from './shared.ts';

const MESSAGE_DISPOSE =
	'WebKit has no Symbol.dispose / Symbol.asyncDispose, so this call throws there: call `close()` (a scope, a flights) instead.';

export const dispose_by_close = {
	meta: {
		type: 'problem',
		docs: { description: 'Owners are closed with close(), never through Symbol.dispose.' }
	},
	create(context: Context) {
		if (!in_source(context)) return {};
		const is_dispose_symbol = (n: Node | undefined): boolean => {
			if (n?.type !== 'MemberExpression') return false;
			const obj = n.object as Node;
			const prop = n.property as Node;
			return (
				obj.type === 'Identifier' &&
				obj.name === 'Symbol' &&
				prop.type === 'Identifier' &&
				(prop.name === 'dispose' || prop.name === 'asyncDispose')
			);
		};
		return {
			CallExpression(node: Node) {
				let callee = node.callee as Node;
				if (callee.type === 'ChainExpression') callee = callee.expression as Node;
				if (
					callee.type === 'MemberExpression' &&
					callee.computed &&
					is_dispose_symbol(callee.property as Node)
				)
					context.report({ node, message: MESSAGE_DISPOSE });
			}
		};
	}
};
