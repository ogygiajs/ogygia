/**
 * `ogygia/one-hash` (#484): a content hash is core's `contract/hash.ts` (`id64` for identity, where a
 * collision serves the wrong thing; `bucket32` for spreading). The FNV-1a offset basis anywhere else
 * is a copy, and says why it must be one on the line before (a seeded hash, one over bytes, a client
 * island's own copy): `// oxlint-disable-next-line ogygia/one-hash -- <why>` (the old `// hash:`
 * mark excuses nothing: internal/lint/reason-notes.test.ts).
 */

import { in_source, type Context, type Node } from './shared.ts';

const FNV_BASIS = 0x811c9dc5;
const MESSAGE_HASH =
	"An FNV-1a copy: use id64 / bucket32 from core's contract/hash.ts, or say why this must be its own on the line before: `// oxlint-disable-next-line ogygia/one-hash -- <why>`.";

export const one_hash = {
	meta: {
		type: 'problem',
		docs: { description: 'One content hash implementation: contract/hash.ts.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!in_source(context) || file.endsWith('packages/core/src/contract/hash.ts')) return {};
		return {
			Literal(node: Node) {
				if ((node as { value?: unknown }).value === FNV_BASIS)
					context.report({ node, message: MESSAGE_HASH });
			}
		};
	}
};
