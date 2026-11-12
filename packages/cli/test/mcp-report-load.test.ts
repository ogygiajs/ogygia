// `ogygia mcp` is a long-lived stdio server: it loads the profiler's report reading
// (`@ogygia/devtools/report`) from the app's own install on first need. A load that failed (the
// plugin not installed yet) must not be kept: once it is installed, the next call loads it, with no
// restart of the server (#295).
//
// The server runs as it does for real: plain node, in the app's directory (under vitest the
// workspace's own @ogygia/devtools would resolve from anywhere).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const MCP = fileURLToPath(new URL('../src/mcp.ts', import.meta.url));
let app: string | null = null;
afterEach(() => {
	if (app) rmSync(app, { recursive: true, force: true });
	app = null;
});

it('a failed load of the report reading is tried again once the plugin is installed', () => {
	app = mkdtempSync(join(tmpdir(), 'og-mcp-report-'));
	writeFileSync(join(app, 'package.json'), '{"name":"app","private":true}');
	const script = `
		import { mkdirSync, writeFileSync } from 'node:fs';
		import { join } from 'node:path';
		const { load_profiler_reading } = await import(${JSON.stringify(MCP)});
		const before = await load_profiler_reading();
		const pkg = join(process.cwd(), 'node_modules', '@ogygia', 'devtools');
		mkdirSync(pkg, { recursive: true });
		writeFileSync(join(pkg, 'package.json'), JSON.stringify({
			name: '@ogygia/devtools', type: 'module', exports: { './report': './report.js' }
		}));
		writeFileSync(join(pkg, 'report.js'), 'export const fix_impact = () => undefined;');
		const after = await load_profiler_reading();
		const again = await load_profiler_reading();
		console.log(JSON.stringify({
			before: before === null,
			after: typeof after?.fix_impact,
			kept: again === after
		}));
	`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: app,
		// (pnpm's bin shim puts the workspace's hoisted .pnpm/node_modules on NODE_PATH)
		env: { ...process.env, NODE_PATH: '' },
		encoding: 'utf8'
	});
	expect(JSON.parse(out.trim().split('\n').pop()!)).toEqual({
		before: true,
		after: 'function',
		kept: true
	});
});
