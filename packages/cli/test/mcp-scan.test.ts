import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatch_tool } from '../src/mcp.ts';

let root = '';
afterEach(() => {
	if (root) rmSync(root, { recursive: true, force: true });
	root = '';
});

it('ogygia_scan: a file Svelte cannot parse is left out, and the other files are still scanned', async () => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-scan-')));
	mkdirSync(path.join(root, 'routes'), { recursive: true });
	writeFileSync(path.join(root, 'routes', 'Broken.svelte'), '{#if}');
	writeFileSync(
		path.join(root, 'routes', '+page.svelte'),
		"<script>import Counter from './Counter.svelte' with { wake: 'load' }</script><Counter />"
	);
	writeFileSync(path.join(root, 'routes', 'Counter.svelte'), '<button>+</button>');
	const out = await dispatch_tool('ogygia_scan', { dir: root });
	expect(out.isError).toBeFalsy();
	expect(out.content.map((c) => c.text).join('\n')).toContain('Counter');
});
