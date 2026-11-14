/**
 * Every value a leg fills in at its end reaches its chunk in a real build: a csr=false app whose
 * code provides context (so the browser can decode an `og.$` function) builds without
 * `relocation_unpatched`, minified or not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { build, type Rollup } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { dedent } from '@ogygia/core/contract';
import { ogygia } from '../src/vite/index.ts';

let root = '';
afterEach(() => {
	vi.restoreAllMocks();
	if (root) fs.rmSync(root, { recursive: true, force: true });
	root = '';
});

function write(rel: string, text: string): void {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, text);
}

function app(): void {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-relocations-build-')));
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	write('src/entry.ts', "import 'ogygia:boot/hydrate-features';\nexport const entry = 1;\n");
	write('src/routes/+layout.ts', 'export const csr = false;\n');
	write(
		'src/routes/+page.svelte',
		`${dedent`
			<script>
				import W from '$lib/W.svelte' with { wake: 'visible' };
			</script>
			<W />
		`}\n`
	);
	write('src/lib/W.svelte', '<p>w</p>\n');
	write('src/lib/ctx.ts', "import { setContext } from 'ogygia';\nexport const set = setContext;\n");
	const svelte_dir = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
	fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
	fs.symlinkSync(svelte_dir, path.join(root, 'node_modules', 'svelte'), 'dir');
}

describe('relocations in a real build', () => {
	it.each([true, false])(
		'a csr=false client build (minify: %s) leaves nothing unpatched',
		async (minify) => {
			app();
			const warned: string[] = [];
			vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
				warned.push(a.map(String).join(' '));
			});
			const out = (await build({
				root,
				logLevel: 'silent',
				configFile: false,
				resolve: { alias: { $lib: path.join(root, 'src', 'lib') } },
				plugins: [...ogygia(), svelte({ configFile: false })],
				build: {
					write: false,
					minify,
					rolldownOptions: {
						input: path.join(root, 'src', 'entry.ts'),
						external: [/^\$app\//]
					}
				}
			})) as Rollup.RolldownOutput;
			expect(out.output.length).toBeGreaterThan(0);
			expect(warned.filter((w) => w.includes('relocation_unpatched'))).toEqual([]);
		}
	);
});
