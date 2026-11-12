import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preprocess, type PreprocessorGroup } from 'svelte/compiler';
import { strip_markup_ts } from './strip-ts.ts';

export { strip_markup_ts };

export interface SvelteOptions {
	/** the package root the other paths are relative to (default: the working directory) */
	root?: string;
	/** the source dir holding the components (default: `src`) */
	src?: string;
	/** the output dir, tsdown's `outDir` (default: `dist`) */
	out?: string;
	/** preprocessors for the script and style (default: vite-plugin-svelte's `vitePreprocess({ script: true })`) */
	preprocess?: PreprocessorGroup | PreprocessorGroup[];
	/** generate `.svelte.d.ts` beside each component (default: true; needs `svelte2tsx` and `typescript`) */
	dts?: boolean;
	/** the tsconfig the component types are emitted with, relative to `root` (default: `tsconfig.json`) */
	tsconfig?: string;
}

const DTS_TSCONFIG = '.svelte-dts.tsconfig.json';

interface EmitContext {
	emitFile(file: { type: 'asset'; fileName: string; source: string | Uint8Array }): string;
}

const slash_relative = (dir: string, abs: string) => relative(dir, abs).split('\\').join('/');

const RELATIVE_TS_SPECIFIER =
	/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]+?)\.ts\2/g;

/** A shipped component sits beside the BUILT modules: its relative `./x.ts` imports (static, dynamic,
 *  or a JSDoc `import('./x.ts')` type) name `./x.js`, the way tsdown rewrites the `.ts` sources. */
export function js_specifiers(source: string): string {
	return source.replace(RELATIVE_TS_SPECIFIER, '$1$2$3.js$2');
}

async function default_preprocess(): Promise<PreprocessorGroup> {
	try {
		const { vitePreprocess } = await import('@sveltejs/vite-plugin-svelte');
		return vitePreprocess({ script: true });
	} catch {
		throw new Error(
			'@ogygia/tsdown-plugin-svelte: pass `preprocess`, or install @sveltejs/vite-plugin-svelte for the default'
		);
	}
}

/**
 * A tsdown plugin that ships a library's Svelte components the way svelte-package does: each
 * `.svelte` under `src` lands in the output dir as preprocessed, uncompiled, TypeScript-free source
 * with a `.svelte.d.ts` beside it, and each `.css` is copied as it is. Relative `./x.ts` imports
 * in both name the built `./x.js`.
 */
export function svelte(options: SvelteOptions = {}) {
	const root = resolve(options.root ?? process.cwd());
	const src = resolve(root, options.src ?? 'src');
	const out = resolve(root, options.out ?? 'dist');
	return {
		name: '@ogygia/tsdown-plugin-svelte',
		async buildStart(this: EmitContext) {
			const pre = options.preprocess ?? (await default_preprocess());
			for (const file of globSync('**/*.{svelte,css}', { cwd: src })) {
				const abs = join(src, file);
				const fileName = slash_relative(src, abs);
				let source = readFileSync(abs, 'utf8');
				if (abs.endsWith('.svelte')) {
					({ code: source } = await preprocess(source, pre, { filename: abs }));
					source = js_specifiers(strip_markup_ts(source, abs));
				}
				this.emitFile({ type: 'asset', fileName, source });
			}
		},
		async writeBundle() {
			if (options.dts === false) return;
			const { emitDts } = await import('svelte2tsx');
			const all_types = join(root, '.svelte-dts');
			rmSync(all_types, { recursive: true, force: true });
			const base = resolve(root, options.tsconfig ?? 'tsconfig.json');
			const scratch = join(root, DTS_TSCONFIG);
			if (existsSync(base))
				writeFileSync(
					scratch,
					JSON.stringify({
						extends: './' + slash_relative(root, base),
						compilerOptions: { isolatedDeclarations: false }
					})
				);
			try {
				await emitDts({
					libRoot: src,
					declarationDir: all_types,
					svelteShimsPath: fileURLToPath(import.meta.resolve('svelte2tsx/svelte-shims-v4.d.ts')),
					...(existsSync(scratch) ? { tsconfig: DTS_TSCONFIG } : {})
				});
				for (const file of globSync('**/*.svelte', { cwd: src })) {
					const rel = slash_relative(src, join(src, file)) + '.d.ts';
					const from = join(all_types, rel);
					if (!existsSync(from)) continue;
					const to = join(out, rel);
					mkdirSync(dirname(to), { recursive: true });
					writeFileSync(to, js_specifiers(readFileSync(from, 'utf8')));
				}
			} finally {
				rmSync(all_types, { recursive: true, force: true });
				rmSync(scratch, { force: true });
			}
		}
	};
}

export default svelte;
