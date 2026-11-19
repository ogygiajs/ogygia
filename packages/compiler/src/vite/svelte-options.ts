import type { CompileOptions } from 'svelte/compiler';

/** The parts of vite-plugin-svelte's resolved options that decide how it compiles a component. */
export interface SvelteCompile {
	readonly compilerOptions?: CompileOptions;
	dynamicCompileOptions?(data: {
		filename: string;
		code: string;
		compileOptions: CompileOptions;
	}): Promise<Partial<CompileOptions> | void> | Partial<CompileOptions> | void;
}

/** The app's Svelte compile, read off vite-plugin-svelte's resolved options (its config plugin
 *  publishes them as `api.options`, resolved before any plugin's own configResolved); null when
 *  the app lists no vite-plugin-svelte. */
export function svelte_compile(
	plugins: readonly { name?: string; api?: unknown }[] | undefined
): SvelteCompile | null {
	const api = plugins?.find((p) => p.name === 'vite-plugin-svelte:config')?.api as
		| { options?: SvelteCompile }
		| undefined;
	return api?.options ?? null;
}

/** The options vite-plugin-svelte compiles `filename` with: the app's `compilerOptions`, then that
 *  file's `dynamicCompileOptions`. */
export async function app_compile_options(
	svelte: SvelteCompile | null,
	filename: string,
	code: string
): Promise<CompileOptions> {
	const base: CompileOptions = { ...svelte?.compilerOptions };
	const dynamic = await svelte?.dynamicCompileOptions?.({ filename, code, compileOptions: base });
	return dynamic ? { ...base, ...dynamic } : base;
}
