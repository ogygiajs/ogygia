/**
 * A component source made compilable by `svelte.compile` alone, for the build-time tree-CSS
 * collection (`compileFoucScopedCss`): `<style lang="scss|sass">` compiled to CSS, `<script
 * lang="ts">` stripped of TypeScript. The compiler reads neither dialect; without this step such a
 * component's scoped CSS compiles to nothing (or ships raw and unscoped) and a server-rendered
 * subtree styled that way goes unstyled.
 *
 * Node-only (this is the Vite leg): `sass-embedded` or `sass` is resolved from the APP root, the
 * way vitePreprocess finds it (neither installed → the block is left as is, one warning); TS is
 * stripped with Vite's own transform (oxc on Vite ≥ 8, esbuild before).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { warn } from '../compiler/messages.ts';
import { component_blocks } from '../compiler/parse/scan.ts';
import { attr_spans } from '@ogygia/core/contract';
import { say } from '@ogygia/machine';

type Sass = { compileString(source: string, options?: Record<string, unknown>): { css: string } };
type Transform = (
	code: string,
	id: string,
	options?: Record<string, unknown>
) => Promise<{ code: string }>;

let sass: Sass | null | undefined;
/** Said once for the process. */
const sass_missing = say({ max: 1 });
let transform: Transform | null | undefined;

function load_sass(root: string): Sass | null {
	if (sass !== undefined) return sass;
	const require = createRequire(path.join(root, 'package.json'));
	for (const name of ['sass-embedded', 'sass']) {
		try {
			sass = require(name) as Sass;
			return sass;
		} catch {
			// ok: not installed; the next is tried, and none says sass_missing
		}
	}
	sass = null;
	return sass;
}

async function load_ts_transform(): Promise<Transform | null> {
	if (transform !== undefined) return transform;
	const vite = (await import('vite')) as Record<string, unknown>;
	const oxc = vite.transformWithOxc as
		| ((code: string, id: string, o?: unknown) => Promise<{ code: string }>)
		| undefined;
	const esbuild = vite.transformWithEsbuild as
		| ((code: string, id: string, o?: unknown) => Promise<{ code: string }>)
		| undefined;
	transform = oxc
		? (code, id) => oxc(code, id, { lang: 'ts', typescript: { onlyRemoveTypeImports: true } })
		: esbuild
			? (code, id) =>
					esbuild(code, id, {
						loader: 'ts',
						target: 'esnext',
						tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } }
					})
			: null;
	return transform;
}

/** `source` with `<style lang="scss|sass">` compiled to CSS and `<script lang="ts">` stripped of TS. */
export async function preprocess_component_for_css(
	source: string,
	abs: string,
	root: string
): Promise<string> {
	const blocks = component_blocks(source);
	const sassy = (lang: string | null) => lang === 'scss' || lang === 'sass';
	const sass_compiler = blocks.some((b) => b.kind === 'style' && sassy(b.lang))
		? load_sass(root)
		: undefined;
	if (sass_compiler === null) sass_missing.once('sass_missing', () => warn('sass_missing'));
	const ts = blocks.some((b) => b.kind === 'script' && b.lang === 'ts')
		? await load_ts_transform()
		: null;

	let out = '';
	let at = 0;
	const splice = (start: number, end: number, text: string) => {
		out += source.slice(at, start) + text;
		at = end;
	};
	for (const b of blocks) {
		const body = source.slice(b.start, b.end);
		if (b.kind === 'style' && sass_compiler && sassy(b.lang)) {
			try {
				const { css } = sass_compiler.compileString(body, {
					syntax: b.lang === 'sass' ? 'indented' : 'scss',
					loadPaths: [path.dirname(abs), root, path.join(root, 'node_modules')],
					quietDeps: true,
					silenceDeprecations: ['import']
				});
				for (const [s, e] of attr_spans(source, b.tag, 'style', 'lang')) splice(s, e, '');
				splice(b.start, b.end, css);
			} catch (err) {
				warn('scss_compile_failed', {
					file: path.relative(root, abs),
					reason: (err as Error).message
				});
			}
		} else if (b.kind === 'script' && ts && b.lang === 'ts') {
			try {
				const { code } = await ts(body, `${abs}.ts`);
				splice(b.start, b.end, code);
			} catch (err) {
				warn('ts_strip_failed', {
					file: path.relative(root, abs),
					reason: (err as Error).message
				});
			}
		}
	}
	return at === 0 ? source : out + source.slice(at);
}
