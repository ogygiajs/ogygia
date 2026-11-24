import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { content } from '@ogygia/content/vite';
import { devtools } from '@ogygia/devtools/vite';
import { diff_markers, inline_markers } from '@ogygia/content/markdown';
import { defineConfig, type Plugin } from 'vite';
import { load_ogygia_themes } from './src/lib/code/shiki-themes.ts';
import { remarkChangelog } from './src/lib/remark-changelog.ts';
import { release_dates } from './src/lib/releases/dates.ts';
import {
	expandApi,
	expandApiCacheKey,
	expandApiDependencies
} from './src/lib/api-ref/expand-api.ts';

// Custom site Shiki themes (forest neutrals + green) — the same ogygia-light / ogygia-dark used by
// the snippets highlighter, so .svx fences match hand-highlighted code.
const themes = await load_ogygia_themes();

// The Releases pages' dates, once at build into `virtual:release-dates`: when npm published each
// version (the registry's `time`, fetched once per package and kept in Vite's cache dir, so dev does
// not fetch again), the release tags' dates when the registry is out of reach (src/lib/releases/dates.ts).
const releaseDates = (): Plugin => {
	const ID = 'virtual:release-dates';
	let cache_dir = '';
	/** The published packages: each with a changelog, not private. */
	const published = (): string[] => {
		const root = fileURLToPath(new URL('../../packages/', import.meta.url));
		const names: string[] = [];
		for (const dir of readdirSync(root)) {
			if (!existsSync(path.join(root, dir, 'CHANGELOG.md'))) continue;
			const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
			if (!pkg.private) names.push(pkg.name);
		}
		return names;
	};
	return {
		name: 'docs-release-dates',
		configResolved: (config) => void (cache_dir = config.cacheDir),
		resolveId: (id) => (id === ID ? `\0${ID}` : null),
		async load(id) {
			if (id !== `\0${ID}`) return null;
			return `export default ${JSON.stringify(await release_dates(published(), cache_dir))};`;
		}
	};
};

// The /og route's two WebAssembly engines, as `virtual:og-wasm`. Workers refuse to compile WASM
// from bytes at runtime, so the build leaves each `.wasm` import for wrangler, which ships it as a
// compiled module. Dev runs in Node, so there the module reads the bytes instead.
const ogWasm = (): Plugin => {
	const ID = 'virtual:og-wasm';
	const FILES = { yoga: 'satori/yoga.wasm', resvg: '@resvg/resvg-wasm/index_bg.wasm' } as const;
	const wasm_files: ReadonlySet<string> = new Set(Object.values(FILES));
	let command: 'build' | 'serve' = 'serve';
	return {
		name: 'docs-og-wasm',
		enforce: 'pre',
		configResolved: (config) => void (command = config.command),
		resolveId(id) {
			if (id === ID) return `\0${ID}`;
			if (command === 'build' && wasm_files.has(id)) return { id, external: true };
			return null;
		},
		load(id) {
			if (id !== `\0${ID}`) return null;
			const entries = Object.entries(FILES);
			if (command === 'build')
				return entries
					.map(
						([k, f]) =>
							`export const ${k} = () => import(${JSON.stringify(f)}).then((m) => m.default);`
					)
					.join('\n');
			return [
				`import { readFile } from 'node:fs/promises';`,
				`import { createRequire } from 'node:module';`,
				`const require = createRequire(${JSON.stringify(import.meta.url)});`,
				...entries.map(
					([k, f]) =>
						`export const ${k} = () => readFile(require.resolve(${JSON.stringify(f)})).then((b) => new Uint8Array(b));`
				)
			].join('\n');
		}
	};
};

// Plugins live here; Kit config (adapter, extensions, preprocess) lives in svelte.config.js — the
// Kit v2 home that `svelte-check` and the editor's Svelte language server read. The content() plugin
// registers its markdown config synchronously here (before sveltekit() loads svelte.config.js), so
// the value-free `extensions()` / `preprocess()` from `@ogygia/content/vite` in svelte.config.js
// resolve to the full markdown pipeline for the build.
export default defineConfig(({ command }) => ({
	optimizeDeps: {
		include: [
			// Reached only from code-split islands (the search palette, the section switcher), so the
			// cold scan misses them: the first page view re-optimized and reloaded mid-load, and a test
			// clicking during it lost its menu.
			'@ogygia/content > @orama/orama',
			'bits-ui',
			'ogygia > @ogygia/core > esm-env',
			'ogygia > @ogygia/core > estree-walker',
			'ogygia > @ogygia/core > magic-string'
		]
	},
	// The site targets modern browsers only (`esnext`).
	build: { target: 'esnext' },
	plugins: [
		ogWasm(),
		releaseDates(),
		ogygia({
			visible: { margin: '120px' },
			presets: {
				demo: { wake: 'visible', margin: '200px' },
				frozenSwr: { render: 'live', wake: 'load' }
			}
		}),
		// The devtools dock (launcher + Lens/Bytes/Wire/Nav/Timeline) and the SSR profiler (UI at
		// /__profiler), both dev only: the site deploys to Cloudflare Workers, which has no
		// node:inspector and no process.cpuUsage for the profiler to record with.
		devtools({ dock: command === 'serve', profiler: command === 'serve' }),
		content({
			markdown: {
				themes: { light: themes.light, dark: themes.dark },
				defaultColor: 'light-dark()',
				wrapperClass: 'code-only',
				// The two diff dialects (line `+++ `/`--- ` prefixes + inline `+++x+++`/`---x---`),
				// dogfooded on the markdown-authoring page.
				code: { transformers: [diff_markers(), inline_markers()] },
				// Reshape the Releases page's `## [x] — date` headings into a clean version + a date
				// line under it. `enforce: 'pre'` so the heading-id/TOC collectors see "0.5.0".
				// expandApi: `> MODULE: ogygia/…` → the auto-generated API reference, regenerated from
				// the package's own d.ts on every build — cache_key re-keys the doc cache when the
				// d.ts set changes; dependencies lets Vite recompile affected pages in dev.
				remark: [
					{ enforce: 'pre', plugin: remarkChangelog },
					{
						enforce: 'pre',
						plugin: expandApi,
						cache_key: expandApiCacheKey,
						dependencies: expandApiDependencies
					}
				]
			},
			// The /playground sub-app's markdown variant: its collections name this preset on their
			// loader macros. Depth-2 merge means unstated keys INHERIT the docs base above — and the
			// playground must rely on NOTHING of ours (its own shell, its own themes: the whole
			// point of the sub-layout split). So the preset restates EVERY key the base sets —
			// stock Shiki themes, stock defaults, no docs transformers, no changelog remark — making
			// it byte-equivalent to the standalone playground's pipeline (defaults + overrides). A
			// future edit to the docs base above can never reach it.
			presets: {
				playground: {
					markdown: {
						overrides: true,
						themes: { light: 'github-light', dark: 'github-dark' },
						defaultColor: 'light-dark()',
						wrapperClass: 'code-only',
						code: {},
						remark: []
					}
				}
			}
		}),
		sveltekit()
	]
}));
