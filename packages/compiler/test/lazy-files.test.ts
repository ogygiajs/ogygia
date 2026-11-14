// vite/lazy-files.ts: each lazy loader (`import_again(() => import('…'))`) is handed its own file at
// build time, so a failed download is asked for again under a fresh URL in every engine: WebKit's
// error names no file (#385), and Firefox's names the dependency that failed, not the file imported.
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rolldown } from 'rolldown';
import { lazy_files } from '../src/vite/lazy-files.ts';
import { FILE, relocate, type RelocateCx } from '../src/link/relocations.ts';
import { dedent } from '@ogygia/core/plugin/utils';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-lazy-files-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(files: Record<string, string>): void {
	for (const [name, source] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		fs.writeFileSync(path.join(dir, name), source);
	}
}

/** What an `import_again` call was given (the stub below hands it back). */
type Given = {
	load: () => Promise<unknown>;
	fresh: (url: string) => Promise<unknown>;
	file: unknown;
	base: unknown;
};

/** Builds `main.js` and runs its output: each export is what its `import_again` call was given. */
async function built(minify: boolean): Promise<Record<string, Given>> {
	const bundle = await rolldown({
		input: path.join(dir, 'main.js'),
		plugins: [
			lazy_files(),
			// (the build half: the file tokens are relocations, replaced with the others at renderChunk)
			{
				name: 'relocate-files',
				renderChunk(code, chunk, _options, meta) {
					const facades = new Map<string, string>();
					for (const c of Object.values(meta.chunks))
						if (c.facadeModuleId) facades.set(c.facadeModuleId, c.fileName);
					const s = relocate(code, [FILE], new Map(), {
						chunk_file: chunk.fileName,
						facade_file: (id) => facades.get(id)
					} as RelocateCx);
					return s && { code: s.s.toString(), map: s.s.generateMap({ hires: true }) };
				}
			}
		]
	});
	const out = path.join(dir, minify ? 'out-min' : 'out');
	await bundle.write({ dir: out, format: 'es', minify, chunkFileNames: '[name]-[hash].js' });
	await bundle.close();
	const main = await import(path.join(out, 'main.js'));
	return main as Record<string, Given>;
}

describe('lazy_files', () => {
	write({
		'import-again.js': `export const import_again = (load, fresh, file, base) => ({ load, fresh, file, base });\n`,
		'main.js': `${dedent`
			import { import_again } from './import-again.js';
			import { shared } from './shared.js';
			console.log(shared);
			export const own = import_again(() => import('./lazy/own.js'));
			export const merged = import_again(() => import('./shared.js'));
			export const part = import_again(() => import('./lazy/part.js').then(({ a }) => ({ a })), (url) => import(/* @vite-ignore */ url).then(({ a }) => ({ a })));
		`}\n`,
		'lazy/own.js': `export const own = 1;\n`,
		'lazy/part.js': `${dedent`
			export const a = 'kept';
			export const b = 'left out';
		`}\n`,
		'shared.js': `export const shared = 2;\n`
	});

	for (const minify of [false, true])
		it(`hands each loader its own chunk, relative to the loader's module${minify ? ' (minified)' : ''}`, async () => {
			const { own } = await built(minify);
			expect(typeof own.base).toBe('string');
			const file = new URL(own.file as string, own.base as string);
			const ns = await import(file.href);
			expect(ns.own).toBe(1);
			expect(await own.load()).toBe(ns);
		});

	for (const minify of [false, true])
		it(`hands a loader that reads part of its module its own chunk, and leaves the rest out${minify ? ' (minified)' : ''}`, async () => {
			const { part } = await built(minify);
			const file = new URL(part.file as string, part.base as string);
			expect(fs.readFileSync(file, 'utf8')).not.toContain('left out');
			expect(await part.load()).toEqual({ a: 'kept' });
			expect(await part.fresh(file.href)).toEqual({ a: 'kept' });
		});

	it('hands a module that shares a chunk with others no file (its chunk is not its own)', async () => {
		const { merged } = await built(false);
		expect(merged.file).toBe(null);
	});
});

describe('lazy_files on the dev server', () => {
	const dev_transform = async (code: string, resolved: string) => {
		const plugin = lazy_files();
		(plugin.configResolved as (c: unknown) => void)({ command: 'serve' });
		const out = await (
			plugin.transform as (this: unknown, code: string, id: string) => Promise<unknown>
		).call({ resolve: async () => ({ id: resolved, external: false }) }, code, '/app/src/a.ts');
		return (out as { code?: string } | null)?.code ?? null;
	};

	it("a package loader is handed its file's dev URL; a virtual module has none", async () => {
		const call = `import_again(() => import('pkg'));`;
		expect(await dev_transform(call, '/app/node_modules/pkg/x.js')).toContain(
			`"/@fs/app/node_modules/pkg/x.js", import.meta.url`
		);
		expect(await dev_transform(call, '\0virtual:pkg')).toContain(', null, import.meta.url');
	});

	it('a call that already names its file (three arguments) is left as written', async () => {
		const call = `import_again(() => import('pkg'), (u) => import(u), '/x.js');`;
		expect((await dev_transform(call, '/app/x.js')) ?? call).toBe(call);
	});
});
