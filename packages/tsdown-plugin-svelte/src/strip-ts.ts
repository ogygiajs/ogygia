import MagicString from 'magic-string';
import { parse } from 'svelte/compiler';

interface Span {
	type?: string;
	start: number;
	end: number;
	[k: string]: unknown;
}

interface Attr extends Span {
	name: string;
	value: unknown;
}

interface Root {
	fragment: unknown;
	instance?: { attributes: Attr[] } | null;
	module?: { attributes: Attr[] } | null;
}

const is_node = (v: unknown): v is Span =>
	!!v &&
	typeof v === 'object' &&
	typeof (v as Span).start === 'number' &&
	typeof (v as Span).end === 'number';

/** keys that hold a type, never a value: cut the whole span and do not look inside */
const TYPE_KEYS: ReadonlySet<string> = new Set([
	'typeAnnotation',
	'typeArguments',
	'typeParameters',
	'returnType'
]);

function static_attr_text(a: Attr): string | undefined {
	const v = a.value;
	if (!Array.isArray(v) || v.length !== 1) return undefined;
	const t = v[0] as { type?: string; data?: string };
	return t.type === 'Text' ? t.data : undefined;
}

const has_ts_script = (source: string) =>
	source.includes('lang="ts"') || source.includes("lang='ts'");

/**
 * Turns a TypeScript Svelte component into a plain-JS one, for shipping raw. Run it on the output
 * of `preprocess()`, which transpiles the `<script>` but never the template: this cuts every
 * type-only span (`as` / `satisfies` casts, `!` and `<T>` assertions, annotations, generic
 * arguments) out of the template, by Svelte's own parse, and drops `lang="ts"` from each script.
 */
export function strip_markup_ts(source: string, filename?: string): string {
	if (!has_ts_script(source)) return source;
	const ast = parse(source, { modern: true, filename }) as unknown as Root;
	const s = new MagicString(source);
	const seen = new Set<unknown>();

	const visit = (v: unknown): void => {
		if (!v || typeof v !== 'object' || seen.has(v)) return;
		seen.add(v);
		if (Array.isArray(v)) {
			for (const x of v) visit(x);
			return;
		}
		const n = v as Span;
		if (
			n.type === 'TSAsExpression' ||
			n.type === 'TSSatisfiesExpression' ||
			n.type === 'TSNonNullExpression'
		) {
			const inner = n.expression as Span;
			if (inner.end < n.end) s.remove(inner.end, n.end);
			visit(inner);
			return;
		}
		if (n.type === 'TSTypeAssertion') {
			const inner = n.expression as Span;
			if (n.start < inner.start) s.remove(n.start, inner.start);
			visit(inner);
			return;
		}
		for (const k in n) {
			if (k === 'parent' || k === 'metadata') continue;
			const c = n[k];
			if (TYPE_KEYS.has(k)) {
				if (is_node(c) && c.start < c.end) s.remove(c.start, c.end);
				continue;
			}
			visit(c);
		}
	};
	visit(ast.fragment);
	for (const script of [ast.instance, ast.module])
		for (const a of script?.attributes ?? [])
			if (a.name === 'lang' && static_attr_text(a) === 'ts')
				remove_with_leading_space(s, source, a);
	return s.hasChanged() ? s.toString() : source;
}

function remove_with_leading_space(s: MagicString, source: string, span: Span): void {
	let from = span.start;
	while (
		from > 0 &&
		(source[from - 1] === ' ' || source[from - 1] === '\t' || source[from - 1] === '\n')
	)
		from--;
	s.remove(from, span.end);
}
