// The shared AST readers macros use (src/parse/ast.ts): a walk over a parsed module with many
// calls, the line of each call, and each call's literal arguments read back as values.
import { bench } from '@bench/heisenbench/bench';
import { parse_module, type AstNode } from '../src/parse/oxc.ts';
import { line_of, literal_of, NOT_LITERAL, walk_ast } from '../src/parse/ast.ts';

function module_source(calls: number): string {
	const lines = [`import { x } from './x';`];
	for (let i = 0; i < calls; i++)
		lines.push(
			`export const v${i} = call('./a-${i}.jpg', { quality: ${i % 100}, ops: { aspect: 16 / 9, flip: ${i % 2 === 0} }, list: [1, -2, \`t\`] } as const);`
		);
	return `${lines.join('\n')}\n`;
}

bench(
	'ast readers: walk a module of sixty calls, then each call’s line and literal arguments',
	({ src, program }) => {
		let n = 0;
		walk_ast(program, (node) => {
			if (node.type !== 'CallExpression') return;
			n += line_of(src, node.start as number);
			for (const arg of node.arguments as AstNode[]) if (literal_of(arg) !== NOT_LITERAL) n++;
		});
		return n;
	},
	{
		setup: () => {
			const src = module_source(60);
			return { src, program: parse_module(src, 'm.ts').program! };
		},
		scale: (_ctx, k) => {
			const src = module_source(60 * k);
			return { src, program: parse_module(src, 'm.ts').program! };
		}
	}
);
