/**
 * Svelte importers: the imports live in `<script>` and `<script module>` blocks. The Svelte parser
 * (modern AST, the one the region transform uses) gives their exact content ranges — no regex over
 * markup, so a `<script>` inside a template string or an `{@html}` never confuses us. The block's
 * `lang` picks the dialect: the slice is parsed under `<file>.svelte.ts` / `<file>.svelte.js`.
 * The styles are blanked before the parse (`blank_styles`): only the scripts are read.
 */
import type MagicString from 'magic-string';
import { parse } from 'svelte/compiler';
import { blank_styles } from '@ogygia/core/internal/compiler';
import { rewrite_imports, type Lookup, type RewriteMove, type RewritePolicy } from './rewrite.ts';

type SvelteAst = ReturnType<typeof parse>;
type Script = NonNullable<SvelteAst['instance']>;

function lang_of_block(block: Script): 'ts' | 'js' {
	for (const attr of block.attributes) {
		if (attr.type !== 'Attribute' || attr.name !== 'lang' || attr.value === true) continue;
		const chunks: { type: string; data?: string }[] = Array.isArray(attr.value)
			? attr.value
			: [attr.value];
		const v = chunks.map((t) => (t.type === 'Text' ? (t.data ?? '') : '')).join('');
		return v === 'ts' || v === 'typescript' ? 'ts' : 'js';
	}
	return 'js';
}

/** Why a component was skipped: the parser's code and where (1-based line and column). */
export interface SvelteSkip {
	code: string;
	line?: number;
	column?: number;
}

/** Rewrite the imports in a Svelte component's script blocks, into `ms`. `on_skip`: told when the
 *  component cannot be parsed (its imports then stay on their barrels), so the plugin warns and
 *  counts it rather than skip in silence. */
export async function rewrite_svelte(
	code: string,
	filename: string,
	lookup: Lookup,
	ms: MagicString,
	policy: RewritePolicy = {},
	on_skip?: (why: SvelteSkip) => void
): Promise<RewriteMove[]> {
	let ast: SvelteAst;
	try {
		ast = parse(blank_styles(code), { modern: true, filename });
	} catch (err) {
		const e = err as {
			code?: string;
			start?: { line?: number; column?: number };
			message?: string;
		};
		on_skip?.({
			code: e.code ?? (e.message ?? 'parse error').split('\n')[0].slice(0, 80),
			line: e.start?.line,
			column: e.start?.column !== undefined ? e.start.column + 1 : undefined
		});
		return []; // the Svelte compiler will report the syntax error
	}
	const moves: RewriteMove[] = [];
	for (const block of [ast.module, ast.instance]) {
		if (!block) continue;
		const { start, end } = block.content;
		const inner = code.slice(start, end);
		const id = `${filename}.${lang_of_block(block)}`;
		moves.push(...(await rewrite_imports(inner, id, lookup, ms, start, policy)));
	}
	return moves;
}
