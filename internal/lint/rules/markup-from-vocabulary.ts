// ── markup-from-vocabulary ──
// A marker's name is spelled once, in core's wire-markup.ts (#479): a package writes `OG_HOLE`, not
// the attribute's text, so a renamed or retired marker cannot leave a stale copy behind.

import type { Context, Node } from './shared.ts';

const MARKER_TEXT = /data-og(?:ygia)?-/;
const VOCABULARY = /(^|\/)packages\/core\/src\/wire-markup\.ts$/;
const MESSAGE_MARKER =
	'A `data-og-*` / `data-ogygia-*` marker is spelled once, in packages/core/src/wire-markup.ts: import its constant (core: ../wire-markup.ts; the compiler: @ogygia/core/contract; other packages: @ogygia/core/internal/server on the server, @ogygia/core/internal/instruments in the browser).';

export const markup_from_vocabulary = {
	meta: {
		type: 'problem',
		docs: { description: 'Package source names markers through the wire-markup.ts constants.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!/(^|\/)packages\/[^/]+\/src\//.test(file) || VOCABULARY.test(file)) return {};
		const check = (node: Node, text: unknown) => {
			if (typeof text === 'string' && MARKER_TEXT.test(text))
				context.report({ node, message: MESSAGE_MARKER });
		};
		return {
			Literal(node: Node) {
				check(node, node.value);
			},
			TemplateElement(node: Node) {
				check(node, (node.value as { raw?: string } | undefined)?.raw);
			}
		};
	}
};
