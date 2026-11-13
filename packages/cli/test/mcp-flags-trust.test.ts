// The `flags` MCP tool reads a directory it is pointed at (`dir`, a tool argument an agent picks). It
// reads that directory's files and runs none of its code: the flag inventory is loaded from the
// server's own project (the directory it was started in), never from `dir`'s node_modules.
//
// The server runs as it does for real: plain node, in its own project's directory.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const MCP = fileURLToPath(new URL('../src/mcp.ts', import.meta.url));
let dirs: string[] = [];
afterEach(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	dirs = [];
});

it("the flags tool pointed at another directory runs none of that directory's code", () => {
	const own = mkdtempSync(join(tmpdir(), 'og-mcp-own-'));
	const other = mkdtempSync(join(tmpdir(), 'og-mcp-other-'));
	dirs.push(own, other);
	writeFileSync(join(own, 'package.json'), '{"name":"own","private":true}');
	writeFileSync(join(other, 'package.json'), '{"name":"other","private":true}');
	const pkg = join(other, 'node_modules', '@ogygia', 'flags');
	mkdirSync(pkg, { recursive: true });
	writeFileSync(
		join(pkg, 'package.json'),
		JSON.stringify({
			name: '@ogygia/flags',
			type: 'module',
			exports: { './internal/inventory': './inventory.js' }
		})
	);
	writeFileSync(join(pkg, 'inventory.js'), 'globalThis.__ran_other_code = true;');
	const script = `
		const { dispatch_tool } = await import(${JSON.stringify(MCP)});
		const res = await dispatch_tool('ogygia_flags', { dir: ${JSON.stringify(other)} });
		console.log(JSON.stringify({ ran: globalThis.__ran_other_code === true, error: !!res.isError }));
	`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: own,
		encoding: 'utf8'
	});
	expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ ran: false, error: false });
});
