/**
 * `image()`: images for an ogygia app, listed beside `ogygia()`
 * (`plugins: [ogygia(), image({ presets }), sveltekit()]`).
 *
 *   const hero = import.meta.og.image('./hero.jpg');   // → an ImageDescriptor (a SOURCE)
 *   <Img of={hero} preset="cover" alt="…" />            // from '@ogygia/image'
 *
 * Three moments:
 * - COMPILE: the macro (./macro.ts) turns each call into an import of the file under the `og-image`
 *   query; `load` turns that into the source's descriptor: its id, size, placeholder, and the
 *   original shipped as an ordinary asset. Nothing is encoded.
 * - RENDER: `<Img>` picks the files from the layout or preset and signs one URL per file (../server.ts).
 * - SETTLE: the server realm's endpoint makes each file on first request, in dev and on a live
 *   server; the build makes the files of warmed presets and prerendered pages (./build-files.ts).
 *
 * With `@ogygia/content`, markdown images and frontmatter image paths become descriptors too
 * (./markdown.ts).
 *
 * @packageDocumentation
 */
import path from 'node:path';
import type { Plugin as VitePlugin, ResolvedConfig } from 'vite';
import { dedent } from '@ogygia/core/contract';
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import type { ImageDescriptor } from '../descriptor.ts';
import {
	DEFAULT_BREAKPOINTS,
	DEFAULT_FORMATS,
	type AppPaths,
	type RenderConfig
} from '../config.ts';
import { OgygiaError } from '../messages.ts';
import { UNPUBLISHED_RE, type BuildHandoff } from '../store.ts';
import { handoff_for, write_built, type WarmSource } from './build-files.ts';
import { check_encoder, encoder_runtime } from './encoder.ts';
import { plan_image, settle } from './plan.ts';
import { EXTENSION_API, markdown_extension } from './markdown.ts';
import { image_call_edits, options_of_query, QUERY } from './macro.ts';
import { check_image_options, check_plugin_options, type ImagePluginOptions } from './options.ts';

export type {
	ImageLayout,
	ImageOps,
	ImageOptions,
	ImagePluginOptions,
	ImagePosition,
	ImagePreset,
	OutputFormat
} from './options.ts';

const QUERY_RE = new RegExp(`[?&]${QUERY}(?:=|&|$)`);
const CONFIG_ID = 'virtual:ogygia-image/config';
const SOURCES_ID = 'virtual:ogygia-image/sources';
const SOURCE_GLOBS: readonly string[] = [
	'/src/**/*.{png,PNG,jpg,JPG,jpeg,JPEG,webp,WEBP,avif,AVIF,gif,GIF,tif,TIF,tiff,TIFF}',
	'!/src/lib/server/**',
	'!/src/**/__tests__/**',
	'!/src/**/*.{test,spec}.*'
];

function render_config(opts: ImagePluginOptions, paths: AppPaths, warmed: boolean): RenderConfig {
	return {
		formats: opts.formats ?? DEFAULT_FORMATS,
		breakpoints: opts.breakpoints ?? DEFAULT_BREAKPOINTS,
		...(opts.quality !== undefined ? { quality: opts.quality } : {}),
		presets: opts.presets ?? {},
		paths,
		warmed
	};
}

function kit_paths(define: Record<string, unknown> | undefined): AppPaths | null {
	const read = (key: string): string | null => {
		const v = define?.[key];
		return typeof v === 'string' ? (JSON.parse(v) as string) : null;
	};
	const app_dir = read('__SVELTEKIT_APP_DIR__');
	if (app_dir === null) return null;
	return {
		base: read('__SVELTEKIT_PATHS_BASE__') ?? '',
		assets: read('__SVELTEKIT_PATHS_ASSETS__') ?? '',
		app_dir
	};
}

function descriptor_module(file: string, plan: Omit<ImageDescriptor, 'src' | 'alt'>): string {
	const data = JSON.stringify(plan).slice(1, -1);
	return dedent`
		import __src from ${JSON.stringify(`${file}?no-inline`)};
		export default {"src":__src,${data}};
	`;
}

/** The image plugin. */
export function image(options?: ImagePluginOptions): VitePlugin[] {
	const opts = check_plugin_options(options);
	const presets = Object.keys(opts.presets ?? {});
	let config: ResolvedConfig | undefined;
	let paths: AppPaths | null = null;
	let handoff: BuildHandoff | null = null;
	let preview = false;
	const warmed = new Map<string, WarmSource>();
	const markdown = markdown_extension(opts);
	const build = (): boolean => config?.command === 'build';
	const server_build = (): boolean => build() && !!config?.build.ssr;

	const ogygia: OgygiaPlugin = definePlugin({
		name: '@ogygia/image',
		server: import.meta.resolve('../server.ts'),
		build(b) {
			b.macro('image', (code, m) =>
				image_call_edits(code, m.id, m.regions(code), m.watch, presets)
			);
		}
	});

	const loader: VitePlugin = {
		name: '@ogygia/image:load',
		enforce: 'pre',
		...(markdown ? { api: { [EXTENSION_API]: markdown } } : {}),
		config: (_, env) => {
			preview = !!env.isPreview;
			return { optimizeDeps: { exclude: ['@ogygia/image'] } };
		},
		async configResolved(c) {
			config = c;
			paths = kit_paths(c.define);
			const named = c.define?.__SVELTEKIT_ADAPTER_NAME__;
			const adapter = typeof named === 'string' ? (JSON.parse(named) as string) : null;
			const runtime = encoder_runtime(c.command, !!c.build.ssr, preview, adapter);
			if (runtime !== null) check_encoder(c.root, runtime, adapter);
			handoff = await handoff_for(build(), c.root);
		},
		async buildStart() {
			if (config && build()) handoff = await handoff_for(true, config.root);
		},
		resolveId(id) {
			if (id === CONFIG_ID || id === SOURCES_ID) return `\0${id}`;
			return null;
		},
		async load(id) {
			if (id === `\0${CONFIG_ID}`) {
				if (!paths) throw new OgygiaError('image_no_kit');
				return `export default ${JSON.stringify(render_config(opts, paths, build()))};\n`;
			}
			if (id === `\0${SOURCES_ID}`)
				return `export default import.meta.glob(${JSON.stringify(SOURCE_GLOBS)}, { query: '?no-inline', import: 'default', eager: true });\n`;
			const q = id.indexOf('?');
			if (q === -1 || !QUERY_RE.test(id.slice(q))) return null;
			const file = id.slice(0, q);
			const own = check_image_options(
				path.basename(file),
				options_of_query(id.slice(q + 1)),
				presets
			);
			if (config) {
				const rel = path.relative(config.root, file).split(path.sep).join('/');
				if (!rel.startsWith('src/') || UNPUBLISHED_RE.test(rel))
					throw new OgygiaError('image_outside_src', { file: rel, src: 'src' });
			}
			const settings = settle(opts, own);
			this.addWatchFile(file);
			const plan = await plan_image(file, settings);
			const warm = typeof own.warm === 'string' ? [own.warm] : own.warm;
			const desc: Omit<ImageDescriptor, 'src' | 'alt'> = {
				id: plan.id,
				width: plan.width,
				height: plan.height,
				format: plan.format,
				...(plan.ph ? { ph: plan.ph } : {}),
				...(plan.animated ? { animated: true } : {}),
				...(settings.quality !== undefined ? { quality: settings.quality } : {}),
				...(Object.keys(settings.ops).length ? { ops: settings.ops } : {}),
				...(warm?.length ? { warm } : {})
			};
			if (warm?.length) warmed.set(id, { file, desc, presets: warm });
			return descriptor_module(file, desc);
		},
		writeBundle: {
			order: 'post',
			sequential: true,
			async handler() {
				if (!handoff || !paths || !config || !server_build()) return;
				await write_built(
					handoff,
					render_config(opts, paths, true),
					warmed.values(),
					path.dirname(path.resolve(config.root, config.build.outDir))
				);
			}
		}
	};

	return [ogygia, loader];
}
