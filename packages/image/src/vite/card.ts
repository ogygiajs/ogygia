/**
 * SHARE CARDS at build: `import.meta.og.image.card('./Card.svelte', { width, height, fonts })`.
 *
 * - The macro checks the call (a `.svelte` component, a whole size, at least one `.woff`/`.ttf`/`.otf`
 *   font, each read here for its family, weight and style) and turns it into an import of the card's
 *   module, `virtual:ogygia-image/card/<card>`, named by the call's arguments.
 * - The card's module renders its component and hands the spec to `card()` (../card.ts). On the server
 *   the component is imported under the `og-card` query, it and every component it imports, so each
 *   is compiled with its CSS in the render (`css="injected"`) for satori to read; the page's own
 *   copy is left as it is. In the browser it only refuses (`image_no_server`).
 * - The card's DIGEST is a hash of every module and font its module imports (their bytes, a
 *   package's too, and their built code) and the engine's versions, worked out by the server build
 *   from the finished module graph and written over a placeholder when the chunk is rendered, so a
 *   change to a child component, its CSS or a font names new files, and nothing else does. The dev
 *   server names new files at each change instead.
 * - The ENDPOINT finds a card by name in `virtual:ogygia-image/cards`: in the build, a list of the
 *   cards' own chunks (each card's module is emitted as one), written at the same time; in dev, the
 *   card's module, imported by name.
 *
 * @packageDocumentation
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attr_spans, dedent, next_any_tag, tag_name } from '@ogygia/core/contract';
import { decisions, flights, random, STALE, type Decisions } from '@ogygia/machine';
import { card_id, type CardProps, type CardSpec } from '../card.ts';
import { OgygiaError, warn } from '../messages.ts';
import { card_of_tail, SIDE_MAX } from '../recipe.ts';
import { ENCODER_VERSION } from '../source-id.ts';
import { card_png, ENGINE_PACKAGES } from '../cards/engine.ts';
import { card_image_reader, type CardImageRead } from '../cards/images.ts';
import type { EncoderRuntime } from './encoder.ts';
import { font_face, FontUnreadable, type FontFace } from './font-face.ts';

/** The prefix of a card's module id. */
export const CARD_PREFIX = 'virtual:ogygia-image/card/';
/** The id of the endpoint's list of cards. */
export const CARDS_ID = 'virtual:ogygia-image/cards';
/** The query a card's components are compiled under. */
export const CARD_QUERY = 'og-card';

const CARD_KEYS: ReadonlySet<string> = new Set(['width', 'height', 'fonts']);
const FONT_EXT_RE = /\.(?:woff|ttf|otf)$/i;
const NAME_LENGTH = 16;
const LIST = '__ogygia_image_cards__';
const LIST_RE = /(["'`])__ogygia_image_cards__\1/;
const DIGEST_RE = /(["'`])__ogygia_image_card_digest_([A-Za-z0-9_-]+)__\1/g;
const OPTIONS_TAG = 'svelte:options';
const CARD_QUERY_RE = new RegExp(`[?&]${CARD_QUERY}(?:&|$)`);

function file_of(url: string): string {
	return fileURLToPath(url).split(path.sep).join('/');
}

const CARD_RUNTIME: string = file_of(import.meta.resolve('../card.ts'));
const CARD_BROWSER: string = file_of(import.meta.resolve('../card-browser.ts'));
const CARD_ENGINE: string = file_of(import.meta.resolve('../cards/engine.ts'));
const CARD_LIST: string = file_of(import.meta.resolve('../cards/list.ts'));
const CARD_NONE: string = file_of(import.meta.resolve('../cards/none.ts'));

/** One font a card is drawn with: its file and what it says it is. */
export interface CardFontFile {
	file: string;
	face: FontFace;
}

/** One card, as its macro call defines it. */
export interface CardDef {
	/** Its name in URLs and module ids. */
	name: string;
	/** Its component's file. */
	file: string;
	/** The component's project path. */
	rel: string;
	width: number;
	height: number;
	fonts: readonly CardFontFile[];
}

/** What the engine check reads: the runtime the server build runs in, and the app's engine. */
export interface CardEngineInput {
	runtime: EncoderRuntime;
	installed: boolean;
	listed: 'none' | 'dev' | 'dependencies';
}

/** What a card calls for of the app's engine: go on, warn that the server cannot make cards, or
 *  fail. */
export const CARD_ENGINE_CHECK: Decisions<CardEngineInput, 'ok' | 'edge' | 'missing' | 'unlisted'> =
	decisions({
		name: 'image card engine',
		inputs: {
			runtime: ['dev', 'client', 'prerendered', 'server', 'edge'],
			installed: [false, true],
			listed: ['none', 'dev', 'dependencies']
		},
		decide: (i: CardEngineInput): 'ok' | 'edge' | 'missing' | 'unlisted' => {
			if (i.runtime === 'client') return 'ok';
			if (!i.installed || i.listed === 'none') return 'missing';
			if (i.runtime === 'edge') return 'edge';
			if (i.runtime === 'server' && i.listed !== 'dependencies') return 'unlisted';
			return 'ok';
		}
	});

function package_json(root: string): Record<string, unknown> | null {
	const file = path.join(root, 'package.json');
	return fs.existsSync(file)
		? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)
		: null;
}

function installed_version(root: string, name: string): string | null {
	try {
		const file = createRequire(path.join(root, 'package.json')).resolve(`${name}/package.json`);
		return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string }).version ?? '?';
		// oxlint-disable-next-line ogygia/no-silent-failures -- not resolving is the answer: the engine check names the package
	} catch {
		return null;
	}
}

function listed_in(
	pkg: Record<string, unknown> | null,
	name: string
): 'none' | 'dev' | 'dependencies' {
	const has = (field: string): boolean =>
		typeof (pkg?.[field] as Record<string, unknown> | undefined)?.[name] === 'string';
	if (has('dependencies')) return 'dependencies';
	return has('devDependencies') || has('optionalDependencies') ? 'dev' : 'none';
}

const LISTED_RANK: Readonly<Record<'none' | 'dev' | 'dependencies', number>> = {
	none: 0,
	dev: 1,
	dependencies: 2
};

/** The versions of the engine's packages and Svelte the app has, as one line (part of every
 *  card's digest), or the packages it lacks. */
export function engine_versions(root: string): { line: string; missing: string[] } {
	const missing: string[] = [];
	const parts = [...ENGINE_PACKAGES, 'svelte'].map((name) => {
		const v = installed_version(root, name);
		if (v === null && name !== 'svelte') missing.push(name);
		return `${name}@${v ?? '-'}`;
	});
	return { line: `${parts.join(' ')} encoder ${ENCODER_VERSION}`, missing };
}

function check_engine(root: string, runtime: EncoderRuntime, where: string): void {
	const pkg = package_json(root);
	const { missing } = engine_versions(root);
	let listed: 'none' | 'dev' | 'dependencies' = 'dependencies';
	for (const name of ENGINE_PACKAGES) {
		const l = listed_in(pkg, name);
		if (LISTED_RANK[l] < LISTED_RANK[listed]) listed = l;
	}
	const plan = CARD_ENGINE_CHECK.decide({ runtime, installed: !missing.length, listed });
	if (plan === 'ok') return;
	if (plan === 'edge') {
		if (!said_edge)
			warn('image_no_encoder', {
				what: 'card',
				reason: `${where} is a share card, and this server runs where satori and resvg cannot: a card is served on a page rendered on request only when a prerendered page made the same card`
			});
		said_edge = true;
		return;
	}
	throw new OgygiaError('image_card_engine_missing', {
		missing: (missing.length ? missing : [...ENGINE_PACKAGES]).join(', '),
		...(plan === 'unlisted' ? { dependencies: true } : {})
	});
}

let said_edge = false;

function rel_of(root: string, file: string): string {
	return path.relative(root, file).split(path.sep).join('/');
}

function font_file(where: string, dir: string, importer: string, font: unknown): CardFontFile {
	if (typeof font !== 'string' || !font)
		throw new OgygiaError('image_card_font', {
			where,
			font: JSON.stringify(font) ?? String(font),
			why: 'a font is a path, relative to this file, or a package file'
		});
	let file: string;
	if (font.startsWith('.') || path.isAbsolute(font)) file = path.resolve(dir, font);
	else
		try {
			file = createRequire(importer).resolve(font);
		} catch {
			throw new OgygiaError('image_card_font', { where, font, why: 'no such file' });
		}
	if (!FONT_EXT_RE.test(file))
		throw new OgygiaError('image_card_font', {
			where,
			font,
			why: 'a .woff, .ttf or .otf file (satori reads no WOFF2)'
		});
	if (!fs.existsSync(file))
		throw new OgygiaError('image_card_font', { where, font, why: 'no such file' });
	try {
		return { file, face: font_face(fs.readFileSync(file)) };
	} catch (e) {
		if (!(e instanceof FontUnreadable)) throw e;
		throw new OgygiaError('image_card_font', {
			where,
			font,
			why: `it does not read: ${e.message}`
		});
	}
}

function side(where: string, key: 'width' | 'height', value: unknown): number {
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > SIDE_MAX)
		throw new OgygiaError('image_option_invalid', {
			where,
			key,
			rule: `a whole number of pixels from 1 to ${SIDE_MAX}`
		});
	return value as number;
}

/** `code`, a component, with its options tag asking for its CSS in the render (any `css` it said
 *  before taken out). */
export function with_injected_css(code: string): string {
	for (let t = next_any_tag(code, 0); t !== null; t = next_any_tag(code, t.next)) {
		if (tag_name(code, t) !== OPTIONS_TAG) continue;
		let out = code;
		for (const [start, end] of attr_spans(code, t, OPTIONS_TAG, 'css').reverse())
			out = out.slice(0, start) + out.slice(end);
		const at = t.start + 1 + OPTIONS_TAG.length;
		return `${out.slice(0, at)} css="injected"${out.slice(at)}`;
	}
	return `<${OPTIONS_TAG} css="injected" />\n${code}`;
}

/** Is `id` a component compiled for a card? */
export function is_card_component(id: string): boolean {
	const q = id.indexOf('?');
	return q !== -1 && id.slice(0, q).endsWith('.svelte') && CARD_QUERY_RE.test(id.slice(q));
}

interface GraphInfo {
	importedIds: readonly string[];
	dynamicallyImportedIds: readonly string[];
	code?: string | null;
}

/** The digest of the card whose module is `start`: its definition, the engine's `versions`, and
 *  every module it imports, by its project path, its file's bytes (a package's too: npm and yarn
 *  paths name no version) and its built code (what CSS tooling made of it); a virtual module by
 *  its id and code. */
export function card_digest(
	start: string,
	def: Omit<CardDef, 'file' | 'fonts'> & { fonts: readonly { face: FontFace }[] },
	versions: string,
	root: string,
	info: (id: string) => GraphInfo | null,
	read: (file: string) => Buffer | null
): string {
	const seen = new Map<string, string | null>();
	const stack = [start];
	while (stack.length) {
		const id = stack.pop()!;
		if (seen.has(id)) continue;
		const i = info(id);
		seen.set(id, i?.code ?? null);
		if (i) stack.push(...i.importedIds, ...i.dynamicallyImportedIds);
	}
	const hash = createHash('sha256');
	hash.update(
		JSON.stringify({
			name: def.name,
			rel: def.rel,
			width: def.width,
			height: def.height,
			fonts: def.fonts.map((f) => f.face),
			versions
		})
	);
	const ids = [...seen].map(([id, code]) => {
		if (id.startsWith('\0')) return { key: id, file: null, code };
		const q = id.indexOf('?');
		const bare = q === -1 ? id : id.slice(0, q);
		const key = `${rel_of(root, bare)}${q === -1 ? '' : id.slice(q)}`;
		return { key, file: bare, code };
	});
	ids.sort((a, b) => Number(a.key > b.key) - Number(a.key < b.key));
	for (const { key, file, code } of ids) {
		hash.update(`\0${key}\0`);
		if (file !== null) hash.update(read(file) ?? Buffer.from('(none)'));
		hash.update(`\0code\0${code ?? ''}`);
	}
	return hash.digest('base64url').slice(0, 43);
}

function read_file(file: string): Buffer | null {
	try {
		return fs.readFileSync(file);
		// oxlint-disable-next-line ogygia/no-silent-failures -- a module with no file of its own (a generated one) is named by its id alone
	} catch {
		return null;
	}
}

/** The build's reader of a card's images: an asset from Kit's build `output` (client or server), a
 *  URL with `remote` (the build's guarded, cached fetch: the file it kept; null: no
 *  `image({ remote })`). */
export function build_card_images(
	output: string,
	prefixes: readonly string[],
	remote: ((url: string) => Promise<string>) | null
): CardImageRead {
	return card_image_reader(
		prefixes,
		async (tail) => {
			for (const side of ['client', 'server']) {
				const file = path.join(output, side, ...tail.split('/'));
				if (!path.relative(path.join(output, side), file).startsWith('..') && fs.existsSync(file))
					return fs.readFileSync(file);
			}
			throw new Error(`${tail} is no file of this build's output`);
		},
		remote === null ? null : async (url) => fs.readFileSync(await remote(url.href))
	);
}

/** Every card the app's macro calls define, and what the build made of them. */
export class Cards {
	readonly #defs = new Map<string, CardDef>();
	readonly #refs = new Map<string, string>();
	readonly #chunks = new Map<string, string>();
	readonly #digests = new Map<string, string>();
	readonly #loaded = flights.keyed<{ chunk: string }>()<
		'chunk',
		never,
		Promise<{ spec: CardSpec }>
	>({
		name: 'card chunks',
		key: ['chunk'],
		keep: Infinity,
		run: ({ chunk }: { chunk: string }) =>
			import(pathToFileURL(chunk).href) as Promise<{ spec: CardSpec }>
	});
	readonly #token = random.uuid().replaceAll('-', '').slice(0, 12);
	#loads = 0;

	/** The card a macro call in `importer` defines, checked. */
	define(importer: string, root: string, where: string, src: string, options: unknown): CardDef {
		const dir = path.dirname(importer);
		const file = path.resolve(dir, src);
		if (!file.endsWith('.svelte'))
			throw new OgygiaError('image_option_invalid', {
				where,
				key: 'path',
				rule: 'a Svelte component (a .svelte file): a card is drawn from what it renders'
			});
		if (!fs.existsSync(file)) throw new OgygiaError('image_not_found', { file: where, src });
		if (options === null || typeof options !== 'object' || Array.isArray(options))
			throw new OgygiaError('image_option_invalid', {
				where,
				key: 'options',
				rule: 'an object with the width, the height and the fonts'
			});
		for (const key of Object.keys(options))
			if (!CARD_KEYS.has(key))
				throw new OgygiaError('image_option_unknown', {
					where,
					key,
					known: [...CARD_KEYS].join(', ')
				});
		const o = options as Record<string, unknown>;
		const width = side(where, 'width', o.width);
		const height = side(where, 'height', o.height);
		if (!Array.isArray(o.fonts) || !o.fonts.length)
			throw new OgygiaError('image_card_font', {
				where,
				font: JSON.stringify(o.fonts) ?? 'none',
				why: 'a card lists at least one font: satori draws text with no other'
			});
		const fonts = o.fonts.map((f) => font_file(where, dir, importer, f));
		const rel = rel_of(root, file);
		const name = createHash('sha256')
			.update(JSON.stringify([rel, width, height, fonts.map((f) => rel_of(root, f.file))]))
			.digest('base64url')
			.slice(0, NAME_LENGTH);
		const def: CardDef = { name, file, rel, width, height, fonts };
		this.#defs.set(name, def);
		return def;
	}

	/** The card named `name`, if a macro call defined it. */
	get(name: string): CardDef | undefined {
		return this.#defs.get(name);
	}

	/** The source of a card's module, for `mode`: the browser's refusal, or the server's spec (with
	 *  the engine where it runs; `dev`: a digest of its own each time it loads). Null: no such
	 *  card. */
	module(name: string, mode: 'client' | 'server' | 'edge' | 'dev'): string | null {
		const def = this.#defs.get(name);
		if (def === undefined) return null;
		if (mode === 'client')
			return `export { card_in_browser as default } from ${JSON.stringify(CARD_BROWSER)};\n`;
		const digest =
			mode === 'dev' ? `dev${this.#token}${++this.#loads}` : `__ogygia_image_card_digest_${name}__`;
		const fonts = def.fonts.map(
			(f, i) =>
				`{"name":${JSON.stringify(f.face.name)},"weight":${f.face.weight},"style":${JSON.stringify(f.face.style)},"src":__og_font_${i}}`
		);
		const font_imports = def.fonts.map(
			(f, i) => `import __og_font_${i} from ${JSON.stringify(f.file.split(path.sep).join('/'))};\n`
		);
		const engine =
			mode === 'edge'
				? ''
				: dedent`
					import { card_png } from ${JSON.stringify(CARD_ENGINE)};
					export const png = (props, fonts, images) => card_png(spec, props, fonts, images);
				`;
		return dedent`
			import __og_card from ${JSON.stringify(`${def.file.split(path.sep).join('/')}?${CARD_QUERY}`)};
			import { render } from 'svelte/server';
			import { card } from ${JSON.stringify(CARD_RUNTIME)};
			${font_imports.join('')}export const spec = {"card":${JSON.stringify(name)},"file":${JSON.stringify(def.rel)},"digest":${JSON.stringify(digest)},"width":${def.width},"height":${def.height},"fonts":[${fonts.join(',')}],html: async (props) => { const r = await render(__og_card, { props }); return r.head + r.body; }};
			${engine}export default card(spec);
		`;
	}

	/** Check the engine for a card's module in `runtime`'s server. */
	check(root: string, runtime: EncoderRuntime, name: string): void {
		const def = this.#defs.get(name);
		if (def) check_engine(root, runtime, def.rel);
	}

	/** Note the chunk a build emitted for a card's module. */
	emitted(name: string, ref: string): void {
		this.#refs.set(name, ref);
	}

	/** The source of `virtual:ogygia-image/cards`: in dev, each card's module by name; in a build,
	 *  the list a rendered chunk gets ({@link render_chunk}); where no engine runs, none. */
	list_module(mode: 'server' | 'edge' | 'dev'): string {
		if (mode === 'edge') return `export * from ${JSON.stringify(CARD_NONE)};\n`;
		if (mode === 'dev')
			return dedent`
				export const engine = true;
				export function card_module(name) { return import(/* @vite-ignore */ ${JSON.stringify(`/@id/__x00__${CARD_PREFIX}`)} + name); }
			`;
		return dedent`
			import { find_card } from ${JSON.stringify(CARD_LIST)};
			export const engine = true;
			export function card_module(name) { return find_card(${JSON.stringify(LIST)}, name); }
		`;
	}

	/** `code` (the server chunk `file`) with the cards' placeholders written: each card's digest, and
	 *  the list of cards' chunks. Null: it has none. */
	render_chunk(
		code: string,
		file: () => string,
		root: string,
		file_name: (ref: string) => string,
		info: (id: string) => GraphInfo | null
	): string | null {
		const has_list = LIST_RE.test(code);
		DIGEST_RE.lastIndex = 0;
		const has_digest = DIGEST_RE.test(code);
		if (!has_list && !has_digest) return null;
		let out = code;
		if (has_digest) {
			const versions = engine_versions(root).line;
			out = out.replace(DIGEST_RE, (whole, quote: string, name: string) => {
				const def = this.#defs.get(name);
				if (def === undefined) return whole;
				let digest = this.#digests.get(name);
				if (digest === undefined) {
					digest = card_digest(`\0${CARD_PREFIX}${name}`, def, versions, root, info, read_file);
					this.#digests.set(name, digest);
				}
				return `${quote}${digest}${quote}`;
			});
		}
		if (has_list) {
			const dir = path.posix.dirname(file());
			const entries = [...this.#refs].map(([name, ref]) => {
				let rel = path.posix.relative(dir, file_name(ref));
				if (!rel.startsWith('.')) rel = `./${rel}`;
				return `${JSON.stringify(name)}: () => import(${JSON.stringify(rel)})`;
			});
			out = out.replace(LIST_RE, () => `{${entries.join(', ')}}`);
		}
		return out;
	}

	/** Note where the build wrote each card's chunk (`file_name` of its ref, under `out`). */
	written(out: string, file_name: (ref: string) => string): void {
		for (const [name, ref] of this.#refs) this.#chunks.set(name, path.join(out, file_name(ref)));
	}

	/** The own-size PNG of the card `tail` names (a prerendered page's), for the build's end: drawn
	 *  from the server chunk the build wrote, with the fonts' files, when it is the source `id`; the
	 *  images it names are read by `images` (the build's reader: its output, its remote fetch). */
	async draw(tail: string, id: string, images: CardImageRead): Promise<Uint8Array> {
		const named = card_of_tail(tail);
		const chunk = named === null ? undefined : this.#chunks.get(named.card);
		const def = named === null ? undefined : this.#defs.get(named.card);
		if (named === null || chunk === undefined || def === undefined)
			throw new Error(`its tail ${tail} names no card this build has`);
		const loaded = await this.#loaded.get({ chunk });
		if (loaded === STALE) throw new Error(`the card ${def.rel} was dropped before it loaded`);
		const { spec } = loaded;
		if (card_id(spec, named.props) !== id)
			throw new Error(`the card ${def.rel} is not the source ${id} any more`);
		const fonts = def.fonts.map((f) => {
			const bytes = fs.readFileSync(f.file);
			return bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength
			) as ArrayBuffer;
		});
		return card_png(spec, JSON.parse(named.props) as CardProps, fonts, images);
	}
}
