/**
 * A module's code as AST roots: oxc's program for a script; for a `.svelte` file, its module script,
 * its instance script and its template (Svelte's parser). For an analysis that walks what a module
 * can run or read (context detection here, `page.data` reads in @ogygia/page-keys).
 */
import { parse, type AST } from 'svelte/compiler';
import { parse_module, type AstNode } from './oxc.ts';
import { blank_styles } from '../blank-styles.ts';

/** The roots, or null when the code does not parse. */
export function parse_roots(code: string, id: string, kind: 'svelte' | 'script'): AstNode[] | null {
	if (kind === 'script') {
		const r = parse_module(code, id);
		return r.ok && r.program ? [r.program] : null;
	}
	let ast: AST.Root;
	try {
		// The component's `<style>` is preprocessor territory (SCSS `//` comments, nesting) that
		// Svelte's parser rejects before any preprocessor ran — and a stylesheet never reads the page.
		// Blank its inside (same length, offsets kept) and parse the scripts and the template.
		ast = parse(blank_styles(code), { modern: true, filename: id });
	} catch {
		return null;
	}
	const roots: AstNode[] = [];
	if (ast.module?.content) roots.push(ast.module.content);
	if (ast.instance?.content) roots.push(ast.instance.content);
	if (ast.fragment) roots.push(ast.fragment);
	return roots;
}
