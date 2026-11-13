/**
 * `ogygia_profile` against a server that answers an HTML error page, not the profiler's JSON: the
 * tool quotes the page's words, read the way the browser shows them (#1370). A style's or a
 * script's text is not words, and a `>` inside a quoted value stays inside its tag.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { dispatch_tool } from '../src/mcp.ts';

const PAGE =
	'<html><head><style>body{color:red}</style><script>if (a < b) go()</script></head><body><h1 title="a>b">Boom</h1><p>it broke</p></body></html>';

let server: Server;
let origin: string;
beforeEach(async () => {
	server = createServer((_req, res) => {
		res.writeHead(500, { 'content-type': 'text/html' });
		res.end(PAGE);
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
	await new Promise((r) => server.close(r));
});

it('quotes an HTML error page by its words only', async () => {
	const out = await dispatch_tool('ogygia_profile', { url: `${origin}/p`, runs: 1 });
	const said = out.content.map((c) => c.text).join('\n');
	expect.soft(out.isError).toBe(true);
	expect(said).toContain('HTTP 500). Boom it broke');
});
