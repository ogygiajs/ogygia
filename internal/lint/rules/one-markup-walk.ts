// ── ogygia/one-markup-walk ────────────────────────────────────────────────
// #1370: package source reads HTML through core's tag walk (markup-walk.ts), which reads quotes,
// comments and raw text as a browser does. A regex or an indexOf over tags or attributes is a
// second reader that gets one of those wrong. A site that must stay its own says why with
// `// markup-ok: <why>` on its line, or alone on the line before.

import { in_source, reason_notes, type Context, type Node } from './shared.ts';

/** The walk itself: the one place that may read tags by hand. */
const MARKUP_WALK = /(^|\/)packages\/core\/src\/markup-walk\.ts$/;
/** A regex pattern that reads a tag or an attribute: to a tag's end (`[^>]`), an attribute's
 *  quoted value (`="[^"]`), or a tag's name (`<[a-z`, `<\/?(\w`). */
const READS_MARKUP = [
	/\[\^[^\]]*>[^\]]*\]/,
	/=\\?(["'])\(?(\?:)?\[\^\\?\1/,
	/<(\\?\/\??)?\(?(\?:)?\[(a-z|A-Z|\\w)/
];
/** An indexOf needle shaped like a tag: `<name`, `</name`, `</`, `<!--`. (A bare `<` or `>` is
 *  as often an escaper's prefilter as a reader, so the linter, with no types, leaves it.) */
const MARKUP_NEEDLE = /^(<\/?[A-Za-z!?]|<\/$)/;
const MESSAGE_MARKUP =
	"Reads HTML by hand (a regex or indexOf over tags or attributes): use core's tag walk (markup-walk.ts: tags, next_tag, read_tag, visit_attrs, markup_tokens, markup_text), or say why not with `// markup-ok: <why>`.";

const reads_markup = (pattern: string): boolean => READS_MARKUP.some((re) => re.test(pattern));

export const one_markup_walk = {
	meta: {
		type: 'problem',
		docs: { description: "Package source reads HTML through core's tag walk." }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!in_source(context) || MARKUP_WALK.test(file)) return {};
		const found: Node[] = [];
		/** A string or template literal's text (a template's holes read as nothing). */
		const text_of = (n: Node | undefined): string | undefined => {
			if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
			if (n?.type === 'TemplateLiteral')
				return (n.quasis as Array<{ value: { raw: string } }>).map((q) => q.value.raw).join('');
			return undefined;
		};
		return {
			Literal(node: Node) {
				const regex = (node as { regex?: { pattern: string } }).regex;
				if (regex && reads_markup(regex.pattern)) found.push(node);
			},
			NewExpression(node: Node) {
				const callee = node.callee as Node;
				if (callee.type !== 'Identifier' || (callee as { name?: string }).name !== 'RegExp') return;
				const pattern = text_of((node.arguments as Node[])[0]);
				if (pattern !== undefined && reads_markup(pattern)) found.push(node);
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				if (callee.type !== 'MemberExpression' || callee.computed) return;
				const name = (callee.property as { name?: string }).name;
				if (name !== 'indexOf' && name !== 'lastIndexOf') return;
				const needle = text_of((node.arguments as Node[])[0]);
				if (needle !== undefined && MARKUP_NEEDLE.test(needle)) found.push(node);
			},
			'Program:exit'() {
				if (!found.length) return;
				const excused = reason_notes(context, /^\s*markup-ok:\s*\S/);
				for (const n of found)
					if (!excused(n)) context.report({ node: n, message: MESSAGE_MARKUP });
			}
		};
	}
};
