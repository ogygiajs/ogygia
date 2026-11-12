/**
 * `bake()`: `import.meta.og.bake(fn)`, listed beside `ogygia()`
 * (`plugins: [ogygia(), bake(), sveltekit()]`).
 *
 *   const nav = import.meta.og.bake(() => buildNav());   // → const nav = {…the computed tree…}
 *
 * The macro runs `fn` at build, serializes its result and inlines it (./bake.ts). It runs after every
 * other macro, since it runs code the others may still rewrite, and only on the app's own source.
 * Without this plugin a call fails the build with `macro_needs_plugin`.
 */
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import { rewrite_bake } from './bake.ts';

/** The bake plugin. */
export function bake(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/bake',
		build(b) {
			b.macro(
				'bake',
				(code, m) =>
					rewrite_bake(code, m.id, {
						alias: m.alias,
						root: m.root,
						markupExts: m.markupExts,
						watch: m.watch
					}),
				{ last: true }
			);
		}
	});
}
