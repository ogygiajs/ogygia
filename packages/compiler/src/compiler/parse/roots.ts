import { parse, type AST } from 'svelte/compiler';
import { parse_module, type AstNode } from './oxc.ts';
import { blank_styles } from '../blank-styles.ts';

/** A module's code as AST roots: oxc's program for a script; for a `.svelte` file, its module
 *  script, its instance script and its template. Null when the code does not parse. */
export function parse_roots(code: string, id: string, kind: 'svelte' | 'script'): AstNode[] | null {
	if (kind === 'script') {
		const r = parse_module(code, id);
		return r.ok && r.program ? [r.program] : null;
	}
	let ast: AST.Root;
	try {
		ast = parse(blank_styles(code), { modern: true, filename: id });
	} catch {
		return null; // ok: null is "did not parse"; seed shaping answers 'all' for it, the context hint says nothing
	}
	const roots: AstNode[] = [];
	if (ast.module?.content) roots.push(ast.module.content);
	if (ast.instance?.content) roots.push(ast.instance.content);
	if (ast.fragment) roots.push(ast.fragment);
	return roots;
}
