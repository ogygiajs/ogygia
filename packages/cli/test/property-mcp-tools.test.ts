// The MCP server's tools take their arguments from a client's JSON (`tools/call`), and an AI client
// can send anything. Over generated JSON arguments, each tool that reads only its arguments answers
// with a tool result (text, maybe marked an error) and never rejects: a rejection reaches the client
// only as "Internal error", with no word on what was wrong.
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { dispatch_tool } from '../src/mcp.ts';

/** The tools that read only their arguments (no files, no network, no browser). */
const PURE = [
	'ogygia_compile',
	'ogygia_islands',
	'ogygia_check',
	'ogygia_explain',
	'ogygia_observatory'
];
const KEYS = ['source', 'filename', 'csr', 'files', 'toString', 'valueOf', '__proto__', 'x'];

const SOURCE = fc.constantFrom(
	'',
	'<p>hi</p>',
	'<script>let x = $state(0)</script><button onclick={() => x++}>{x}</button>',
	"<script>import W from './W.svelte' with { wake: 'load' }</script><W />",
	'<script>',
	'{#if}'
);

const { value: json } = fc.letrec((tie) => ({
	value: fc.oneof(
		{ depthSize: 'small' },
		SOURCE,
		fc.jsonValue({ maxDepth: 1 }),
		fc.array(tie('value'), { maxLength: 3 }),
		fc.dictionary(fc.constantFrom(...KEYS), tie('value'), { maxKeys: 4 })
	)
}));

const args = fc
	.dictionary(fc.constantFrom(...KEYS), json, { maxKeys: 4 })
	// as the server gets them: JSON text read back (own `__proto__` / `toString` keys and all)
	.map((a) => JSON.parse(JSON.stringify(a)) as Record<string, unknown>);

describe('MCP tools over any JSON arguments', () => {
	it('answer with a text result and never reject', async () => {
		await fc.assert(
			fc.asyncProperty(fc.constantFrom(...PURE), args, async (tool, a) => {
				const out = await dispatch_tool(tool, a);
				expect(Array.isArray(out.content)).toBe(true);
				for (const c of out.content) {
					expect(c.type).toBe('text');
					expect(typeof c.text).toBe('string');
				}
			}),
			{ numRuns: 150 }
		);
	}, 120_000);
});
