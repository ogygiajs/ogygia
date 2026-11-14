/**
 * CANARY (#1720): the SvelteKit build and render behaviour the compiler works around, read from each
 * installed Kit's own source. internal/notes/INVARIANTS.md (KIT-CLIENT-BUILD, KIT-CSR-FALSE-ASSETS,
 * KIT-CONFIG) says why each matters; the e2e specs it names prove the workaround on a real build.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { broke, KITS, type Internal } from '../../../core/test/canary/upstream.ts';

const CLIENT_BUILD: Internal = {
	upstream: "SvelteKit's client-build skip (every node `csr === false`)",
	used_by: [
		'packages/compiler/src/kit.ts (clientBuildWillSkip, the keep-client route)',
		'packages/compiler/src/vite/index.ts (KEEP_CLIENT_DIR)'
	],
	issue: 1720
};
const ASSETS: Internal = {
	upstream: "SvelteKit's page assets (`node.stylesheets` and `node.imports` linked on every page)",
	used_by: ['packages/compiler/src/region/emit.ts (the registry stubs of region hosts)'],
	issue: 1720
};
const CONFIG: Internal = {
	upstream:
		"SvelteKit's config options (`files.routes`, `outDir`, `appDir`, `inlineStyleThreshold`)",
	used_by: ['packages/compiler/src/kit.ts (the Kit dirs and the inline threshold)'],
	issue: 1720
};

const read_any = (root: string, files: string[]) =>
	files
		.map((f) => path.join(root, f))
		.filter((f) => fs.existsSync(f))
		.map((f) => fs.readFileSync(f, 'utf8'))
		.join('\n');

describe.each(Object.entries(KITS))('%s', (_, root) => {
	it('skips its client build exactly when every route node is csr=false', () => {
		const build = read_any(root, ['src/exports/vite/index.js', 'src/exports/vite/build/index.js']);
		expect(
			/skip_client_build\s*=\s*manifest_data\.nodes\.every\(\s*\(node\)\s*=>\s*node\.page_options\?\.csr === false/.test(
				build
			),
			broke(
				CLIENT_BUILD,
				'the skip is no longer `manifest_data.nodes.every((node) => node.page_options?.csr === false)`'
			)
		).toBe(true);
	});

	it("links every route node's client stylesheets and preloads, csr=false or not", () => {
		const render = read_any(root, ['src/runtime/server/page/render.js']);
		for (const line of [
			'for (const url of node.imports) modulepreloads.add(url);',
			'for (const url of node.stylesheets) stylesheets.add(url);'
		])
			expect(render, broke(ASSETS, `render.js no longer has \`${line}\``)).toContain(line);
	});

	it('has the config options the compiler reads', () => {
		const options = read_any(root, ['src/core/config/options.js']);
		for (const option of [
			/\bappDir: validate\(/,
			/\broutes: string\(/,
			/\boutDir: string\(/,
			/\binlineStyleThreshold: number\(/
		])
			expect(option.test(options), broke(CONFIG, `options.js has no ${option.source}`)).toBe(true);
	});
});
