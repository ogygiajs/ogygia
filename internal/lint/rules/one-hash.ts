/**
 * `ogygia/one-hash` (#484): a content hash is core's `contract/hash.ts` (`id64` for identity, where a
 * collision serves the wrong thing; `bucket32` for spreading). The FNV-1a offset basis anywhere else
 * is a copy, and says why it must be one with `// hash: <why>` on its line, or alone on the line before (a
 * seeded hash, one over bytes, a client island's own copy).
 */

import { in_source, reason_notes, type Context, type Node } from './shared.ts';

const FNV_BASIS = 0x811c9dc5;
const MESSAGE_HASH =
	"An FNV-1a copy: use id64 / bucket32 from core's contract/hash.ts, or say why this must be its own with `// hash: <why>`.";

export const one_hash = {
	meta: {
		type: 'problem',
		docs: { description: 'One content hash implementation: contract/hash.ts.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!in_source(context) || file.endsWith('packages/core/src/contract/hash.ts')) return {};
		const found: Node[] = [];
		return {
			Literal(node: Node) {
				if ((node as { value?: unknown }).value === FNV_BASIS) found.push(node);
			},
			'Program:exit'() {
				if (!found.length) return;
				const excused = reason_notes(context, /^\s*hash:\s*\S/);
				for (const n of found) if (!excused(n)) context.report({ node: n, message: MESSAGE_HASH });
			}
		};
	}
};
