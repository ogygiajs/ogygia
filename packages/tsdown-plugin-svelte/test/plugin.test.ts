import { afterEach, describe, expect, it } from 'vitest';
import {
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';
import { svelte } from '../src/index.ts';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A small library under the package's node_modules (so svelte and typescript resolve from it). */
function library(files: Record<string, string>): string {
	mkdirSync(join(pkg, 'node_modules'), { recursive: true });
	const root = mkdtempSync(join(pkg, 'node_modules/.plugin-test-'));
	made.push(root);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

const FILES = {
	'src/index.ts': "export { greet } from './util.ts';\n",
	'src/util.ts': 'export const greet = (name: string): string => `hi ${name}`;\n',
	'src/Button.svelte': [
		'<script lang="ts">',
		"\timport { greet } from './util.ts';",
		'\tlet { name }: { name: string } = $props();',
		'</script>',
		'<button>{greet(name as string)}</button>'
	].join('\n'),
	'src/style.css': '.a { color: red; }\n',
	'tsconfig.json': JSON.stringify({
		compilerOptions: {
			target: 'esnext',
			module: 'esnext',
			moduleResolution: 'bundler',
			strict: true,
			skipLibCheck: true,
			declaration: true,
			isolatedDeclarations: true,
			allowImportingTsExtensions: true,
			types: []
		},
		include: ['src']
	})
};

async function build_library(root: string): Promise<string> {
	await build({
		cwd: root,
		config: false,
		entry: ['src/index.ts', 'src/util.ts'],
		format: 'esm',
		unbundle: true,
		dts: true,
		clean: true,
		logLevel: 'silent',
		plugins: [svelte({ root, preprocess: [] })]
	});
	return join(root, 'dist');
}

describe('svelte() in a tsdown build', () => {
	it('ships each component as plain JS beside its types, and a .css as it is, after clean', async () => {
		const root = library(FILES);
		mkdirSync(join(root, 'dist'));
		writeFileSync(join(root, 'dist/stale.js'), '');
		const dist = await build_library(root);
		expect(existsSync(join(dist, 'stale.js'))).toBe(false);
		const button = readFileSync(join(dist, 'Button.svelte'), 'utf8');
		expect(button).not.toContain('lang=');
		expect(button).toContain("from './util.js'");
		expect(button).toContain('{greet(name)}');
		expect(readFileSync(join(dist, 'style.css'), 'utf8')).toBe(FILES['src/style.css']);
		expect(readFileSync(join(dist, 'Button.svelte.d.ts'), 'utf8')).toContain('name: string');
	}, 60_000);

	it('emits component types under a library tsconfig that turns isolatedDeclarations on', async () => {
		const dist = await build_library(library(FILES));
		expect(existsSync(join(dist, 'Button.svelte.d.ts'))).toBe(true);
	}, 60_000);

	it('adds only component types to the output: no svelte2tsx declaration of a .ts module, no scratch files left', async () => {
		const root = library(FILES);
		const dist = await build_library(root);
		const types = globSync('**/*.d.*', { cwd: dist }).sort();
		expect(types.filter((t) => !t.endsWith('.svelte.d.ts'))).toEqual(
			types.filter((t) => t.endsWith('.d.mts'))
		);
		expect(globSync('.svelte-dts*', { cwd: root })).toEqual([]);
	}, 60_000);
});
