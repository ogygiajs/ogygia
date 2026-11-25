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
import { fileURLToPath } from 'node:url';
import type { Plugin as VitePlugin, ResolvedConfig } from 'vite';
import { dedent } from '@ogygia/core/contract';
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import type { ImageDescriptor } from '../descriptor.ts';
import { DARK_MEDIA, other_shape } from '../layout.ts';
import {
	DEFAULT_BREAKPOINTS,
	DEFAULT_FORMATS,
	type AppPaths,
	type OutputFormat,
	type RenderConfig
} from '../config.ts';
import { OgygiaError, warn } from '../messages.ts';
import { UNPUBLISHED_RE, type BuildHandoff } from '../handoff.ts';
import { handoff_for, write_built, type WarmSource } from './build-files.ts';
import {
	check_encoder,
	check_platform,
	encoder_runtime,
	encoders_of,
	maker_module,
	makes_stills,
	maker_of,
	namer_module,
	widths_of
} from './encoder.ts';
import { vercel_config_check } from './vercel-config.ts';
import { plan_image, settle, type Plan, type Settings } from './plan.ts';
import { EXTENSION_API, markdown_extension } from './markdown.ts';
import { image_call_edits, image_specifier, options_of_query, QUERY } from './macro.ts';
import {
	check_image_options,
	check_plugin_options,
	check_qualities,
	type ImageOptions,
	type ImagePluginOptions
} from './options.ts';
import { theme_css } from './theme.ts';

export type {
	ImageLayout,
	ImageOps,
	ImageOptions,
	ImagePluginOptions,
	ImagePosition,
	ImagePreset,
	ImageTheme,
	OutputFormat
} from './options.ts';
export {
	cloudflare,
	sharp,
	vercel,
	type CloudflareOptions,
	type Encoder,
	type VercelImages,
	type VercelOptions
} from './encoder.ts';

const QUERY_RE = new RegExp(`[?&]${QUERY}(?:=|&|$)`);
const CONFIG_ID = 'virtual:ogygia-image/config';
const SOURCES_ID = 'virtual:ogygia-image/sources';
const MAKER_ID = 'virtual:ogygia-image/maker';
const NAMER_ID = 'virtual:ogygia-image/namer';
const THEME_ID = 'virtual:ogygia-image/theme.css';
// @why Kit's dev server inlines a page's CSS by loading each CSS module's URL again with `?inline`, which finds a module only when it has a file-like path, so the theme stylesheet is named as a file that is never written (test: packages/image/test/plugin.test.ts › the theme stylesheet resolves to a file path, with and without a query)
const THEME_FILE: string = fileURLToPath(new URL('../og-theme.css', import.meta.url))
	.split(path.sep)
	.join('/');
const VIRTUAL_IDS: ReadonlySet<string> = new Set([CONFIG_ID, SOURCES_ID, MAKER_ID, NAMER_ID]);
const SOURCE_GLOBS: readonly string[] = [
	'/src/**/*.{png,PNG,jpg,JPG,jpeg,JPEG,webp,WEBP,avif,AVIF,gif,GIF,tif,TIF,tiff,TIFF}',
	'!/src/lib/server/**',
	'!/src/**/__tests__/**',
	'!/src/**/*.{test,spec}.*'
];

function render_config(
	opts: ImagePluginOptions,
	paths: AppPaths,
	warmed: boolean,
	widths: readonly number[] | null,
	stills: boolean
): RenderConfig {
	return {
		formats: opts.formats ?? DEFAULT_FORMATS,
		breakpoints: opts.breakpoints ?? DEFAULT_BREAKPOINTS,
		...(opts.quality !== undefined ? { quality: opts.quality } : {}),
		presets: opts.presets ?? {},
		paths,
		warmed,
		...(widths ? { widths } : {}),
		...(opts.theme ? { themed: true as const } : {}),
		...(stills ? {} : { stills: false as const })
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

function output_of(c: ResolvedConfig): string {
	return path.dirname(path.resolve(c.root, c.build.outDir));
}

function originals_of(paths: AppPaths | null): string {
	return `${paths?.base ?? ''}/${paths?.app_dir ?? '_app'}/immutable/assets/`;
}

/** One twin file a source's options name (`dark`, `art`): its media, and the specifier that loads
 *  its own descriptor. */
interface TwinFile {
	media: string;
	theme?: 'dark';
	file: string;
	plan: Plan;
}

function descriptor_module(
	file: string,
	plan: Omit<ImageDescriptor, 'src' | 'alt' | 'twins'>,
	twins: readonly { twin: TwinFile; specifier: string }[]
): string {
	const data = JSON.stringify(plan).slice(1, -1);
	const imports = twins.map(
		({ specifier }, i) => `import __twin_${i} from ${JSON.stringify(specifier)};\n`
	);
	const list = twins.map(
		({ twin }, i) =>
			`{"media":${JSON.stringify(twin.media)},${twin.theme ? `"theme":"${twin.theme}",` : ''}"of":__twin_${i}}`
	);
	const tail = twins.length ? `,"twins":[${list.join(',')}]` : '';
	return dedent`
		import __src from ${JSON.stringify(`${file}?no-inline`)};
		${imports.join('')}export default {"src":__src,${data}${tail}};
	`;
}

function twin_desc(plan: Plan, settings: Settings): Omit<ImageDescriptor, 'src' | 'alt'> {
	return {
		id: plan.id,
		width: plan.width,
		height: plan.height,
		format: plan.format,
		...(plan.ph ? { ph: plan.ph } : {}),
		...(plan.animated ? { animated: true } : {}),
		...(settings.quality !== undefined ? { quality: settings.quality } : {}),
		...(Object.keys(settings.ops).length ? { ops: settings.ops } : {})
	};
}

async function twin_files(
	file: string,
	own: ImageOptions,
	settings: Settings,
	plan: Plan
): Promise<TwinFile[]> {
	const dir = path.dirname(file);
	const out: TwinFile[] = [];
	for (const [media, src] of Object.entries(own.art ?? {})) {
		const at = path.resolve(dir, src);
		out.push({ media, file: at, plan: await plan_image(at, settings) });
	}
	if (own.dark !== undefined) {
		const at = path.resolve(dir, own.dark);
		const dark = await plan_image(at, settings);
		if (other_shape(dark.width / dark.height, plan.width / plan.height))
			throw new OgygiaError('image_option_invalid', {
				where: path.basename(file),
				key: 'dark',
				rule: `a file of the same shape as ${path.basename(file)} (${plan.width} × ${plan.height}; ${own.dark} is ${dark.width} × ${dark.height}), so the page keeps its box when the theme flips`
			});
		out.push({ media: DARK_MEDIA, theme: 'dark', file: at, plan: dark });
	}
	return out;
}

/** The image plugin. */
export function image(options?: ImagePluginOptions): VitePlugin[] {
	const opts = check_plugin_options(options);
	const presets = Object.keys(opts.presets ?? {});
	const encoders = encoders_of(opts.encoder);
	const widths = widths_of(encoders);
	const stills = makes_stills(encoders);
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
			b.macro('image', (code, m) => image_call_edits(code, m.id, m.markupExts, m.watch, presets));
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
			if (runtime !== null) check_encoder(c.root, runtime, adapter, maker_of(encoders));
			if (c.command === 'build' && c.build.ssr) {
				check_platform(encoders, adapter, originals_of(paths));
				if (!stills)
					warn('image_still_left_out', {
						encoders: encoders.map((e) => `${e.name}()`).join(', ')
					});
			}
			handoff = await handoff_for(build(), c.root);
		},
		async buildStart() {
			if (config && build()) handoff = await handoff_for(true, config.root, output_of(config));
		},
		resolveId(id) {
			const [bare, query] = id.split('?', 2) as [string, string | undefined];
			if (bare === THEME_ID || bare === THEME_FILE || bare === `/@fs${THEME_FILE}`)
				return query === undefined ? THEME_FILE : `${THEME_FILE}?${query}`;
			if (VIRTUAL_IDS.has(id)) return `\0${id}`;
			return null;
		},
		async load(id) {
			if (id === `\0${MAKER_ID}`) return maker_module(encoders, !build());
			if (id === `\0${NAMER_ID}`) return namer_module(encoders, !build());
			if (id.split('?', 1)[0] === THEME_FILE) return theme_css(opts.theme);
			if (id === `\0${CONFIG_ID}`) {
				if (!paths) throw new OgygiaError('image_no_kit');
				const cfg = render_config(opts, paths, build(), widths, !build() || stills);
				return `export default ${JSON.stringify(cfg)};\n`;
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
			const twins = await twin_files(file, own, settings, plan);
			for (const t of twins) this.addWatchFile(t.file);
			const warm = typeof own.warm === 'string' ? [own.warm] : own.warm;
			const desc: Omit<ImageDescriptor, 'src' | 'alt' | 'twins'> = {
				...twin_desc(plan, settings),
				...(warm?.length ? { warm } : {})
			};
			if (warm?.length)
				warmed.set(id, {
					file,
					desc: {
						...desc,
						...(twins.length
							? {
									twins: twins.map((t) => ({
										media: t.media,
										...(t.theme ? { theme: t.theme } : {}),
										of: { ...twin_desc(t.plan, settings), src: '' }
									}))
								}
							: {})
					},
					originals: Object.fromEntries(twins.map((t) => [t.plan.id, t.file])),
					presets: warm
				});
			const twin_options: ImageOptions = {
				...(own.quality !== undefined ? { quality: own.quality } : {}),
				...(own.placeholder !== undefined ? { placeholder: own.placeholder } : {}),
				...(own.ops !== undefined ? { ops: own.ops } : {})
			};
			return descriptor_module(
				file,
				desc,
				twins.map((twin) => ({ twin, specifier: image_specifier(twin.file, twin_options) }))
			);
		},
		writeBundle: {
			order: 'post',
			sequential: true,
			async handler() {
				if (!handoff || !paths || !config || !server_build()) return;
				await write_built(
					handoff,
					render_config(opts, paths, true, widths, stills),
					warmed.values(),
					output_of(config)
				);
			}
		}
	};

	const vercel = encoders.find((e) => e.name === 'vercel');
	if (!vercel) return [ogygia, loader];
	check_qualities(opts, vercel.qualities);
	const asked: OutputFormat[] = [
		...(opts.formats ?? DEFAULT_FORMATS),
		...Object.values(opts.presets ?? {}).flatMap((p) => p.formats ?? [])
	];
	const checked = vercel_config_check(encoders, () => ({
		formats: asked,
		assets: paths?.assets ?? '',
		originals: originals_of(paths)
	}));
	return [ogygia, loader, checked];
}
