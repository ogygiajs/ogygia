/**
 * The ENCODER: who makes an app's image files, and what URL names each. `image({ encoder })` takes
 * one or a list (default `sharp()`); the plugin turns it into two modules at build: the NAMER
 * (`virtual:ogygia-image/namer`, ../namers/: an encoder's own link of a live file, in the server and
 * in the browser) and the MAKER (`virtual:ogygia-image/maker`, ../makers/: what makes a file at the
 * app's endpoint, server only), so a bundle holds only the one it uses. A prerendered page's files
 * are always made by the build, with sharp, whatever the encoder.
 *
 * sharp is a peer the app installs. The build and the dev server load it on first use
 * ({@link pixels}), so the plugin's Vite entry loads in an app that never installed it, and
 * {@link check_encoder} says which line to add before any image is planned. Where sharp must be:
 * listed in the app's package.json and installed for every build and dev server; and, for a server
 * build whose maker is sharp, listed in the app's `dependencies`, the list adapter-node keeps out of
 * its bundle (sharp bundled cannot find its native binary, so every image would answer 500).
 *
 * @packageDocumentation
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedent } from '@ogygia/core/contract';
import { decisions, type Decisions } from '@ogygia/machine';
import { cannot } from '../encoders/capabilities.ts';
import { NEEDS, type Need } from '../encoders/needs.ts';
import { DEFAULT_BREAKPOINTS, DEFAULT_QUALITY } from '../config.ts';
import { OgygiaError, said, warn } from '../messages.ts';
import { host_rule } from '../remote-hosts.ts';
import { peer_state } from './peers.ts';
import type { LinkPlan, NamerPlan } from '../namers/resolve.ts';
import { SIDE_MAX } from '../recipe.ts';

/** Who makes an app's image files, and what URL names each: plain data from a factory
 *  (`sharp()`, `cloudflare()`, `vercel()`), for `image({ encoder })`. */
export interface Encoder {
	/** Which encoder it is. */
	readonly name: 'sharp' | 'cloudflare' | 'vercel';
	/** What its own links can make without the app's endpoint, or null: every live file goes
	 *  through the endpoint. */
	readonly links: readonly Need[] | null;
	/** What makes its files at the app's endpoint, or null: nothing in that runtime. */
	readonly maker: 'sharp' | 'binding' | null;
	/** The Cloudflare Images binding its maker makes files with, or null. */
	readonly binding: string | null;
	/** Whether a CDN picks each file's format from the browser's `Accept` (one URL per width). */
	readonly negotiates: boolean;
	/** The widths it makes: any, or only these. */
	readonly widths: 'any' | readonly number[];
	/** The qualities it makes: any, or only these. */
	readonly qualities: 'any' | readonly number[];
}

/** sharp (the default): the app's own endpoint makes every live file, in dev and on a Node server,
 *  and the build every file a prerendered page names. */
export function sharp(): Encoder {
	return {
		name: 'sharp',
		links: null,
		maker: 'sharp',
		binding: null,
		negotiates: false,
		widths: 'any',
		qualities: 'any'
	};
}

/** What `cloudflare()` takes. */
export interface CloudflareOptions {
	/** Name each file a page rendered on request shows as an Image Transformations link,
	 *  `/cdn-cgi/image/<options>/<original>`, made by Cloudflare's CDN (transformations must be on
	 *  for the zone). Default `true`. `false`: the app's endpoint makes each with the Images
	 *  binding. */
	links?: boolean;
	/** The Images binding the endpoint makes files with: the name the Worker's wrangler config
	 *  gives it (`"images": { "binding": "IMAGES" }`). Default `'IMAGES'`. */
	binding?: string;
}

const CLOUDFLARE_KEYS: ReadonlySet<string> = new Set(['links', 'binding']);
const BINDING_RE = /^[A-Za-z_$][\w$]*$/;

/** Cloudflare, for an app on Workers (adapter-cloudflare): a page rendered on request names its
 *  files as Image Transformations links, and what links cannot name (or every file, with
 *  `links: false`) the app's endpoint makes with the Worker's Images binding, kept in the Worker's
 *  cache. A prerendered page's files are made by the build, with sharp, as with any encoder. */
export function cloudflare(options: CloudflareOptions = {}): Encoder {
	const where = 'cloudflare()';
	if (options === null || typeof options !== 'object' || Array.isArray(options))
		throw new OgygiaError('image_option_invalid', { where, key: 'options', rule: 'an object' });
	for (const key of Object.keys(options))
		if (!CLOUDFLARE_KEYS.has(key))
			throw new OgygiaError('image_option_unknown', {
				where,
				key,
				known: [...CLOUDFLARE_KEYS].join(', ')
			});
	const { links = true, binding = 'IMAGES' } = options;
	if (typeof links !== 'boolean')
		throw new OgygiaError('image_option_invalid', { where, key: 'links', rule: 'a boolean' });
	if (typeof binding !== 'string' || !BINDING_RE.test(binding))
		throw new OgygiaError('image_option_invalid', {
			where,
			key: 'binding',
			rule: 'the name of a binding (letters, digits, _ and $, not starting with a digit)'
		});
	return {
		name: 'cloudflare',
		links: links ? NEEDS.filter((n) => !cannot('cloudflare links').includes(n)) : null,
		maker: 'binding',
		binding,
		negotiates: false,
		widths: 'any',
		qualities: 'any'
	};
}

/** What `vercel()` takes. */
export interface VercelOptions {
	/** The widths Vercel may make (its `images.sizes`): every width a page asks for is snapped up to
	 *  one of these. Default: 16, 32, 48, 64, 96, 128, 256 and 384 (fixed and small images), then
	 *  the plugin's default breakpoints. */
	sizes?: number[];
	/** The qualities Vercel may make (its `images.qualities`), 1–100. Default: 60 and 80, the
	 *  qualities AVIF and WebP files are made at when nothing says one. A plugin or preset `quality`
	 *  must be one of these (the build fails otherwise); a file asking for another is not Vercel's
	 *  to make. */
	qualities?: number[];
}

/** The adapter-vercel `images` config `vercel()` hands over, as `adapter({ images })` takes it. */
export interface VercelImages {
	readonly sizes: number[];
	readonly qualities: number[];
	readonly formats: ('image/avif' | 'image/webp')[];
	readonly domains: string[];
	/** The only paths the optimizer may read: the app's originals (`/_app/immutable/assets/`; the
	 *  build says the value to pass for another `paths.base` or `appDir`). */
	readonly localPatterns: { pathname: string; search: string }[];
	/** The only hosts it may fetch from: those `image({ remote: { hosts } })` lists, for a
	 *  `remoteImage()`. `vercel()` cannot know them: add them as the build says
	 *  (`image_vercel_config`, one entry per host). */
	readonly remotePatterns?: VercelRemotePattern[];
}

/** One `images.remotePatterns` entry: a scheme, a host pattern, a port. */
export interface VercelRemotePattern {
	readonly protocol: 'http' | 'https';
	readonly hostname: string;
	readonly port?: string;
}

const VERCEL_KEYS: ReadonlySet<string> = new Set(['sizes', 'qualities']);
const SMALL_SIZES: readonly number[] = [16, 32, 48, 64, 96, 128, 256, 384];
const VERCEL_QUALITIES: readonly number[] = [DEFAULT_QUALITY.avif, DEFAULT_QUALITY.webp];

/** The path Vercel may read originals under, as an `images.localPatterns` entry. */
export function originals_pattern(originals: string): { pathname: string; search: string } {
	return { pathname: `^${originals.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.+$`, search: '' };
}

function whole_list(where: string, key: string, list: unknown, max: number): number[] | undefined {
	if (list === undefined) return undefined;
	const ok =
		Array.isArray(list) &&
		list.length > 0 &&
		list.every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max);
	if (!ok)
		throw new OgygiaError('image_option_invalid', {
			where,
			key,
			rule: `a non-empty list of whole numbers from 1 to ${max}`
		});
	return [...new Set(list as number[])].sort((a, b) => a - b);
}

/** Vercel, for an app on adapter-vercel: a page rendered on request names each file as an Image
 *  Optimization link, `/_vercel/image?url=…&w=…&q=…`, made by Vercel's CDN, which only resizes
 *  (no crop, position or operation) and picks AVIF or WebP from the browser. Hand its `images` to
 *  the adapter (`adapter({ images: encoder.images })`); the build checks the adapter's output has
 *  them. List `sharp()` after it (`[vercel(), sharp()]`) for the files Vercel cannot make, or they
 *  fail to render. A prerendered page's files are made by the build, with sharp, as with any
 *  encoder. */
export function vercel(options: VercelOptions = {}): Encoder & { readonly images: VercelImages } {
	const where = 'vercel()';
	if (options === null || typeof options !== 'object' || Array.isArray(options))
		throw new OgygiaError('image_option_invalid', { where, key: 'options', rule: 'an object' });
	for (const key of Object.keys(options))
		if (!VERCEL_KEYS.has(key))
			throw new OgygiaError('image_option_unknown', {
				where,
				key,
				known: [...VERCEL_KEYS].join(', ')
			});
	const sizes =
		whole_list(where, 'sizes', options.sizes, SIDE_MAX) ??
		[...new Set([...SMALL_SIZES, ...DEFAULT_BREAKPOINTS])].sort((a, b) => a - b);
	const qualities = whole_list(where, 'qualities', options.qualities, 100) ?? [
		...new Set(VERCEL_QUALITIES)
	];
	return {
		name: 'vercel',
		links: NEEDS.filter((n) => !cannot('vercel').includes(n)),
		maker: null,
		binding: null,
		negotiates: true,
		widths: sizes,
		qualities,
		images: {
			sizes,
			qualities,
			formats: ['image/avif', 'image/webp'],
			domains: [],
			localPatterns: [originals_pattern('/_app/immutable/assets/')]
		}
	};
}

const SHARP: Encoder = sharp();

/** The encoders `image({ encoder })` lists, in order: `sharp()` when it lists none. */
export function encoders_of(encoder: Encoder | readonly Encoder[] | undefined): readonly Encoder[] {
	if (encoder === undefined) return [SHARP];
	return Array.isArray(encoder) ? encoder : [encoder as Encoder];
}

function endpoint_of(encoders: readonly Encoder[]): Encoder | undefined {
	return encoders.find((e) => e.maker !== null);
}

/** The maker of `encoders`: the first that has one, or null. */
export function maker_of(encoders: readonly Encoder[]): Encoder['maker'] {
	return endpoint_of(encoders)?.maker ?? null;
}

function file_of(url: string): string {
	return fileURLToPath(url).split(path.sep).join('/');
}

const MAKERS: Readonly<Record<'sharp' | 'binding' | 'none', string>> = {
	sharp: file_of(import.meta.resolve('../makers/sharp.ts')),
	binding: file_of(import.meta.resolve('../makers/binding.ts')),
	none: file_of(import.meta.resolve('../makers/none.ts'))
};
const ENDPOINT_NAMER: string = file_of(import.meta.resolve('../namers/endpoint.ts'));
const RESOLVE_NAMER: string = file_of(import.meta.resolve('../namers/resolve.ts'));
const LINK_CODE: Readonly<Record<LinkPlan['kind'], { name: string; file: string }>> = {
	cloudflare: {
		name: 'CLOUDFLARE_LINKS',
		file: file_of(import.meta.resolve('../encoders/cloudflare.ts'))
	},
	vercel: { name: 'VERCEL_LINKS', file: file_of(import.meta.resolve('../encoders/vercel.ts')) }
};

/** The source of `virtual:ogygia-image/maker` for `encoders`. The dev server makes every file with
 *  sharp: no Worker binding runs there. */
export function maker_module(encoders: readonly Encoder[], dev: boolean): string {
	const e = endpoint_of(encoders);
	if (dev || e?.maker !== 'binding')
		return `export * from ${JSON.stringify(MAKERS[dev ? 'sharp' : (e?.maker ?? 'none')])};\n`;
	return dedent`
		import { binding_maker } from ${JSON.stringify(MAKERS.binding)};
		const maker = binding_maker(${JSON.stringify(e.binding)});
		export const parallel = maker.parallel;
		export const make = maker.make;
		export const store = maker.store;
	`;
}

function link_plan(x: Encoder): LinkPlan {
	const cannot = NEEDS.filter((n) => !x.links!.includes(n));
	if (x.name !== 'vercel') return { kind: 'cloudflare', cannot };
	return {
		kind: 'vercel',
		cannot,
		sizes: x.widths === 'any' ? [] : x.widths,
		qualities: x.qualities === 'any' ? null : x.qualities
	};
}

/** The widths every file must be one of (the first linking encoder's that lists them, Vercel's
 *  `sizes`), or null: any width. */
export function widths_of(encoders: readonly Encoder[]): readonly number[] | null {
	const e = encoders.find((x) => x.links !== null && x.widths !== 'any');
	return e === undefined || e.widths === 'any' ? null : e.widths;
}

/** Whether `encoders` can make a moving source's still on a page rendered on request: one's links
 *  can, or the endpoint's maker can. */
export function makes_stills(encoders: readonly Encoder[]): boolean {
	const e = endpoint_of(encoders);
	return (
		encoders.some((x) => x.links?.includes('still') === true) ||
		(e !== undefined && !cannot(e.name).includes('still'))
	);
}

/** How `encoders` name a recipe at render ({@link namer_module}). */
export function namer_plan(encoders: readonly Encoder[], dev: boolean): NamerPlan {
	const e = endpoint_of(encoders);
	return {
		encoders: encoders.map((x) => `${x.name}()`).join(', '),
		links: encoders.filter((x) => x.links !== null).map(link_plan),
		endpoint: e === undefined ? null : cannot(e.name),
		dev
	};
}

/** The source of `virtual:ogygia-image/namer` for `encoders`: the endpoint's (it names nothing)
 *  when no encoder has links and the endpoint makes every need, else the plan's. */
export function namer_module(encoders: readonly Encoder[], dev: boolean): string {
	const plan = namer_plan(encoders, dev);
	if (!plan.links.length && plan.endpoint?.length === 0)
		return `export * from ${JSON.stringify(ENDPOINT_NAMER)};\n`;
	const kinds = [...new Set(plan.links.map((l) => l.kind))];
	const imports = kinds.map(
		(k) => `import { ${LINK_CODE[k].name} } from ${JSON.stringify(LINK_CODE[k].file)};\n`
	);
	const code = kinds.map((k) => `${k}: ${LINK_CODE[k].name}`).join(', ');
	return dedent`
		import { namer } from ${JSON.stringify(RESOLVE_NAMER)};
		${imports.join('')}export const name = namer(${JSON.stringify(plan)}, { ${code} });
	`;
}

/** The pixel module (sharp), loaded on first use. */
export function pixels(): Promise<typeof import('../pixels.ts')> {
	return import('../pixels.ts');
}

/** What runs the app this config builds or serves. */
export type EncoderRuntime = 'dev' | 'client' | 'prerendered' | 'server' | 'edge';

/** What an adapter is to the encoders: the runtime its server runs in, and the platform it builds
 *  for (whose links and maker `cloudflare()` and `vercel()` name). */
export interface AdapterKind {
	runtime: 'prerendered' | 'edge' | 'server';
	platform: 'cloudflare' | 'vercel' | 'auto' | 'other';
}

const ADAPTERS: readonly (AdapterKind & { re: RegExp })[] = [
	{ re: /^@sveltejs\/adapter-static$/, runtime: 'prerendered', platform: 'other' },
	{ re: /^@sveltejs\/adapter-cloudflare(?:-workers)?$/, runtime: 'edge', platform: 'cloudflare' },
	{ re: /^@sveltejs\/adapter-vercel$/, runtime: 'server', platform: 'vercel' },
	{ re: /^@sveltejs\/adapter-auto$/, runtime: 'server', platform: 'auto' },
	{ re: /cloudflare|deno|-edge\b/i, runtime: 'edge', platform: 'other' }
];

/** The one table every adapter check reads: what `adapter` (its package name) is. */
export function adapter_kind(adapter: string | null): AdapterKind {
	const row = adapter === null ? undefined : ADAPTERS.find((a) => a.re.test(adapter));
	return row
		? { runtime: row.runtime, platform: row.platform }
		: { runtime: 'server', platform: 'other' };
}

/** The runtime of a resolved config, or null where no image is planned (`vite preview`). */
export function encoder_runtime(
	command: 'build' | 'serve',
	ssr: boolean,
	preview: boolean,
	adapter: string | null
): EncoderRuntime | null {
	if (command === 'serve') return preview ? null : 'dev';
	if (!ssr) return 'client';
	return adapter_kind(adapter).runtime;
}

/** What the encoder check reads: the runtime, the endpoint's maker (`none`: no encoder makes files
 *  there), whether the app chose its encoder (`image({ encoder })`), whether the adapter is
 *  Cloudflare's (where `cloudflare()` exists), and the app's sharp. */
export interface EncoderInput {
	runtime: EncoderRuntime;
	maker: 'sharp' | 'binding' | 'none';
	chosen: boolean;
	cloudflare: boolean;
	installed: boolean;
	listed: 'none' | 'dev' | 'dependencies';
}

/** What a config's sharp calls for: go on, warn that the server cannot encode, fail asking the app
 *  to choose its encoder, or fail. */
export const ENCODER: Decisions<EncoderInput, 'ok' | 'edge' | 'choose' | 'missing' | 'unlisted'> =
	decisions({
		name: 'image encoder',
		inputs: {
			runtime: ['dev', 'client', 'prerendered', 'server', 'edge'],
			maker: ['sharp', 'binding', 'none'],
			chosen: [false, true],
			cloudflare: [false, true],
			installed: [false, true],
			listed: ['none', 'dev', 'dependencies']
		},
		decide: (i: EncoderInput): 'ok' | 'edge' | 'choose' | 'missing' | 'unlisted' => {
			if (!i.installed || i.listed === 'none') return 'missing';
			if (i.maker !== 'sharp') return 'ok';
			if (i.runtime === 'edge') return i.cloudflare && !i.chosen ? 'choose' : 'edge';
			if (i.runtime === 'server' && i.listed !== 'dependencies') return 'unlisted';
			return 'ok';
		}
	});

/** What the platform check reads: the platform an app's encoders name links or a maker on, and the
 *  adapter's. */
export interface PlatformInput {
	platform: 'none' | 'cloudflare' | 'vercel';
	adapter: 'cloudflare' | 'vercel' | 'auto' | 'other';
}

/** Whether a server build's adapter runs where its encoder's links and maker exist: go on, or fail
 *  (on adapter-auto, saying to list the platform's adapter itself). */
export const PLATFORM: Decisions<PlatformInput, 'ok' | 'wrong' | 'auto'> = decisions({
	name: 'image encoder platform',
	inputs: {
		platform: ['none', 'cloudflare', 'vercel'],
		adapter: ['cloudflare', 'vercel', 'auto', 'other']
	},
	decide: (i: PlatformInput): 'ok' | 'wrong' | 'auto' => {
		if (i.platform === 'none' || i.platform === i.adapter) return 'ok';
		return i.adapter === 'auto' ? 'auto' : 'wrong';
	}
});

/** The `remotePatterns` entry of one `image({ remote: { hosts } })` entry: its scheme, its host (a
 *  pattern, as Vercel's output config reads it), and its port when not the default. */
export function remote_pattern(entry: string): VercelRemotePattern | null {
	const rule = host_rule(entry);
	if (rule === null) return null;
	const host = rule.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return {
		protocol: rule.protocol === 'http:' ? 'http' : 'https',
		hostname: rule.below ? `^(?:[^.]+\\.)+${host}$` : `^${host}$`,
		...(rule.port ? { port: rule.port } : {})
	};
}

/** The images `vercel()` hands an app whose originals sit under `originals`, which takes remote
 *  images from `hosts`. */
export function vercel_images(
	encoder: Encoder & { readonly images: VercelImages },
	originals: string,
	hosts: readonly string[] = []
): VercelImages {
	const remote = hosts.flatMap((h) => remote_pattern(h) ?? []);
	return {
		...encoder.images,
		localPatterns: [originals_pattern(originals)],
		...(remote.length ? { remotePatterns: remote } : {})
	};
}

/** Check a server build's `adapter` against the platform `encoders` name: `cloudflare()` fails
 *  `image_option_invalid` and `vercel()` `image_vercel_config` on any other adapter. */
export function check_platform(
	encoders: readonly Encoder[],
	adapter: string | null,
	originals: string,
	hosts: readonly string[] = []
): void {
	const e = encoders.find((x) => x.name !== 'sharp');
	const plan = PLATFORM.decide({
		platform: e?.name === 'cloudflare' || e?.name === 'vercel' ? e.name : 'none',
		adapter: adapter_kind(adapter).platform
	});
	if (plan === 'ok' || e === undefined) return;
	const own = `@sveltejs/adapter-${e.name}`;
	const is = `this app's adapter is ${adapter ?? 'none'}${plan === 'auto' ? `, which picks a platform but cannot be handed its config: install and list ${own} itself` : ''}`;
	if (e.name === 'cloudflare')
		throw new OgygiaError('image_option_invalid', {
			where: 'image()',
			key: 'encoder',
			rule: `cloudflare() on ${own}: its links and Images binding exist only on Cloudflare (${is})`
		});
	const images = vercel_images(e as Encoder & { readonly images: VercelImages }, originals, hosts);
	throw new OgygiaError('image_vercel_config', {
		missing: `adapter-vercel (${is})`,
		have: 'no /_vercel/image',
		line: `adapter({ images: ${JSON.stringify(images)} })`
	});
}

/** Check the app's sharp for `runtime` and the endpoint's `maker` (`chosen`: the app listed its
 *  encoder): throws `image_sharp_missing`; on a Cloudflare adapter with no encoder chosen,
 *  `image_option_invalid` naming `cloudflare()`; or warns `image_no_encoder` (once per adapter)
 *  for one whose runtime cannot load sharp. */
export function check_encoder(
	root: string,
	runtime: EncoderRuntime,
	adapter: string | null,
	maker: Encoder['maker'],
	chosen = false
): void {
	const sharp = peer_state(root, ['sharp']);
	const plan = ENCODER.decide({
		runtime,
		maker: maker ?? 'none',
		chosen,
		cloudflare: adapter_kind(adapter).platform === 'cloudflare',
		installed: sharp.installed,
		listed: sharp.listed
	});
	if (plan === 'edge')
		said.once(`image_no_encoder edge ${adapter ?? ''}`, () =>
			warn('image_no_encoder', {
				reason: `${adapter ?? 'this adapter'} runs the app where sharp, a native Node module, cannot load`
			})
		);
	else if (plan === 'choose')
		throw new OgygiaError('image_option_invalid', {
			where: 'image()',
			key: 'encoder',
			rule: `chosen on ${adapter}: its server cannot load sharp, so list cloudflare() (Cloudflare's links or Images binding make every file), or encoder: sharp() to say only prerendered pages show images`
		});
	else if (plan !== 'ok')
		throw new OgygiaError('image_sharp_missing', { adapter, installed: plan === 'unlisted' });
}
