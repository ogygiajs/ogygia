import type { Context, Node } from './shared.ts';

/** The one module allowed to turn a string into DOM. */
const HTML_SINK_FILE = /(^|\/)packages\/core\/src\/runtime\/html-sink\.ts$/;
/** Assigning these parses a string into DOM. */
const HTML_SETTERS = new Set(['innerHTML', 'outerHTML']);
/** Naming these (to call them, or to read them off an element) parses a string into DOM. */
const HTML_PARSERS = new Set([
	'setHTMLUnsafe',
	'parseHTMLUnsafe',
	'createContextualFragment',
	'insertAdjacentHTML'
]);

const MESSAGE_SINK =
	'A string becomes DOM only in the HTML sink (packages/core/src/runtime/html-sink.ts), from a VerifiedHtml one of its vouchers made. Parse through it.';
const MESSAGE_VOUCH =
	'Only the HTML sink makes a VerifiedHtml (its vouchers, each named by the check it made): a cast skips the check.';

const property_name = (n: Node | undefined): string | undefined =>
	n?.type === 'MemberExpression' ? (n.property as { name?: string }).name : undefined;

/** Does a type node name `VerifiedHtml`? */
function names_verified(t: unknown): boolean {
	const n = t as Node | undefined;
	if (n?.type === 'TSTypeReference') {
		const name = n.typeName as { name?: string } | undefined;
		return name?.name === 'VerifiedHtml';
	}
	if (n?.type === 'TSIntersectionType' || n?.type === 'TSUnionType')
		return (n.types as unknown[]).some(names_verified);
	return false;
}

/**
 * `ogygia/html-sink` (HOLE-TRUST): a string becomes DOM in one module, from HTML it vouched for.
 * Outside it, package source may not assign `innerHTML` / `outerHTML`, name `setHTMLUnsafe`,
 * `parseHTMLUnsafe`, `createContextualFragment` or `insertAdjacentHTML`, make a `DOMParser`, call
 * `document.write`, or cast anything to `VerifiedHtml`.
 */
export const html_sink = {
	meta: {
		type: 'problem',
		docs: { description: 'A string becomes DOM only in the HTML sink, from HTML it vouched for.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!/(^|\/)packages\/[^/]+\/src\//.test(file) || HTML_SINK_FILE.test(file)) return {};
		const cast = (node: Node) => {
			if (names_verified(node.typeAnnotation)) context.report({ node, message: MESSAGE_VOUCH });
		};
		return {
			AssignmentExpression(node: Node) {
				const name = property_name(node.left as Node);
				if (name !== undefined && HTML_SETTERS.has(name))
					context.report({ node, message: MESSAGE_SINK });
			},
			MemberExpression(node: Node) {
				const name = (node.property as { name?: string; value?: unknown }).name;
				if (name !== undefined && HTML_PARSERS.has(name))
					context.report({ node, message: MESSAGE_SINK });
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				const name = property_name(callee);
				if (
					(name === 'write' || name === 'writeln') &&
					((callee.object as { name?: string }).name === 'document' ||
						property_name(callee.object as Node) === 'document')
				)
					context.report({ node, message: MESSAGE_SINK });
			},
			NewExpression(node: Node) {
				if ((node.callee as { name?: string }).name === 'DOMParser')
					context.report({ node, message: MESSAGE_SINK });
			},
			TSAsExpression: cast,
			TSTypeAssertion: cast,
			TSSatisfiesExpression: cast
		};
	}
};
