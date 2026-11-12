// The MCP server over stdio answers every request (a message with an id) exactly once, whatever its
// method and params are: a request left unanswered hangs the client. Run as the client runs it: a
// child process, requests on stdin, answers on stdout.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';

const MCP = join(dirname(fileURLToPath(import.meta.url)), '../src/mcp.ts');

/** Every answer the server writes for `lines`, read once stdin closes. */
function serve(lines: string[]): { id: unknown }[] {
	const out = spawnSync(
		process.execPath,
		['-e', `import(${JSON.stringify(MCP)}).then((m) => m.runMcp())`],
		{
			input: lines.join('\n') + '\n',
			encoding: 'utf8',
			timeout: 30_000
		}
	);
	return out.stdout
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as { id: unknown });
}

const odd = fc.oneof(
	fc.constant({ toString: [] }),
	fc.constant(null),
	fc.integer(),
	fc.array(fc.string({ maxLength: 3 }), { maxLength: 2 }),
	fc.string({ maxLength: 6 })
);
const method = fc.oneof(
	fc.constantFrom('initialize', 'tools/list', 'ping', 'tools/call', 'nope', 'notifications/x'),
	odd
);
const params = fc.oneof(
	odd,
	fc.record({ name: fc.oneof(fc.constantFrom('ogygia_nope', 'ogygia_check'), odd), arguments: odd })
);

describe('the MCP server over stdio', () => {
	it('answers every request exactly once, whatever its method and params', () => {
		fc.assert(
			fc.property(fc.array(fc.tuple(method, params), { minLength: 1, maxLength: 6 }), (reqs) => {
				const lines = reqs.map(([m, p], i) =>
					JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: m, params: p })
				);
				const ids = serve(['null', '[]', ...lines]).map((a) => a.id);
				expect([...ids].sort((a, b) => Number(a) - Number(b))).toEqual(reqs.map((_, i) => i + 1));
			}),
			{ numRuns: 12 }
		);
	}, 300_000);
});
