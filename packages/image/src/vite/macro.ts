/**
 * `import.meta.og.image(src, options?)` and `import.meta.og.image.glob(pattern, options?)`.
 *
 *   const hero = import.meta.og.image('./hero.jpg', { quality: 70 });
 *   // → import __og_image_0 from './hero.jpg?og-image=<options>';  const hero = __og_image_0;
 *
 * The call becomes an import of the file under the plugin's query; the plugin's `load` turns that into
 * the descriptor (./index.ts). A URL on a host `image({ remote: { hosts } })` lists becomes an import
 * of `virtual:ogygia-image/remote/<url>`, which the plugin resolves to the image fetched into the
 * build cache (./remote.ts); any other URL fails the build. Arguments are literals, read from the AST before any code runs, so an
 * option is real JS (numbers, arrays, `16 / 9`) instead of a string inside an import attribute.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import path from 'node:path';
import {
	find_og_calls,
	line_of,
	literal_of,
	NOT_LITERAL,
	og_js_regions,
	og_member,
	parse_module,
	walk_ast,
	type AstNode,
	type Edit
} from '@ogygia/compiler';
import { OgygiaError } from '../messages.ts';
import type { RemoteHosts } from '../remote-hosts.ts';
import { CARD_PREFIX, Cards } from './card.ts';
import { check_image_options, type ImageOptions } from './options.ts';
import { remote_src, remote_url } from './remote.ts';

type Node = AstNode;

export const QUERY = 'og-image';
const URL_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const MARKER = 'import.meta.og.image';

function is_url(src: string): boolean {
	return URL_RE.test(src) || src.startsWith('data:');
}

/** The import specifier that loads `src` as a descriptor with `options`. */
export function image_specifier(src: string, options: ImageOptions = {}): string {
	const keys = Object.keys(options);
	if (!keys.length) return `${src}?${QUERY}`;
	return `${src}?${QUERY}=${Buffer.from(JSON.stringify(options)).toString('base64url')}`;
}

/** The options an `og-image` query carries. */
export function options_of_query(query: string): ImageOptions {
	const value = new URLSearchParams(query).get(QUERY);
	if (!value) return {};
	try {
		return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ImageOptions;
	} catch {
		throw new OgygiaError('image_query_invalid', { query });
	}
}

const WHAT: Readonly<Record<'image' | 'glob' | 'card', string>> = {
	image: 'the path',
	glob: 'the pattern',
	card: 'the component'
};

function member_of(glob: boolean, card: boolean): 'image' | 'glob' | 'card' {
	if (glob) return 'glob';
	return card ? 'card' : 'image';
}

type Call = {
	start: number;
	end: number;
	region: number;
	glob: boolean;
	card: boolean;
	src: string;
	options: ImageOptions;
	/** A card's options, as written (checked by ./card.ts). */
	raw: unknown;
	line: number;
};

function find_calls(
	src: string,
	id: string,
	markup_exts: readonly string[],
	presets: readonly string[]
): Call[] {
	const regions = og_js_regions(src, id, markup_exts);
	if (!regions) return [];
	const calls: Call[] = [];
	const rel = path.basename(id);
	for (const region of regions) {
		if (!region.code.includes(MARKER)) continue;
		const as = markup_exts.some((x) => id.endsWith(x)) ? `${id}.ts` : id;
		const { program, ok } = parse_module(region.code, as);
		if (!ok || !program) continue;
		walk_ast(program, (n) => {
			if (n.type !== 'CallExpression') return;
			const callee = n.callee as Node;
			let glob = false;
			let card = false;
			if (og_member(callee) !== 'image') {
				const member = callee.property?.name;
				if (
					callee.type !== 'MemberExpression' ||
					callee.computed ||
					(member !== 'glob' && member !== 'card') ||
					og_member(callee.object as Node) !== 'image'
				)
					return;
				glob = member === 'glob';
				card = member === 'card';
			}
			const abs = region.offset + (n.start as number);
			const line = line_of(src, abs);
			const args = (n.arguments as Node[] | undefined) ?? [];
			if (args.length < 1 || args.length > 2)
				throw new OgygiaError('image_macro_arity', { file: rel, line });
			const path_value = literal_of(args[0]!);
			if (typeof path_value !== 'string')
				throw new OgygiaError('image_macro_not_literal', {
					file: rel,
					line,
					what: WHAT[member_of(glob, card)]
				});
			let options: unknown = undefined;
			if (args[1]) {
				options = literal_of(args[1]);
				if (options === NOT_LITERAL)
					throw new OgygiaError('image_macro_not_literal', {
						file: rel,
						line,
						what: 'the options'
					});
			}
			calls.push({
				start: abs,
				end: region.offset + (n.end as number),
				region: region.offset,
				glob,
				card,
				src: path_value,
				options: card ? {} : check_image_options(`${rel}:${line}`, options, presets),
				raw: options,
				line
			});
		});
	}
	return calls;
}

function refuse_markup_calls(src: string, id: string, calls: readonly Call[]): void {
	const found = [
		...find_og_calls(src, 'import.meta.og.').filter((c) => c.method === 'image'),
		...find_og_calls(src, `${MARKER}.`).filter((c) => c.method === 'glob' || c.method === 'card')
	];
	for (const c of found)
		if (!calls.some((k) => k.start === c.start))
			throw new OgygiaError('image_macro_in_markup', {
				file: `${path.basename(id)}:${line_of(src, c.start)}`
			});
}

/** The edits that rewrite every image call in `src` (module `id`): none when there is no call. */
export function image_call_edits(
	src: string,
	id: string,
	markup_exts: readonly string[] = ['.svelte'],
	watch: (file: string) => void = () => {},
	presets: readonly string[] = [],
	hosts: RemoteHosts | null = null,
	cards: Cards | null = null,
	root: string = process.cwd()
): Edit[] {
	if (!src.includes(MARKER)) return [];
	const calls = find_calls(src, id, markup_exts, presets);
	if (markup_exts.some((x) => id.endsWith(x))) refuse_markup_calls(src, id, calls);
	if (!calls.length) return [];
	const dir = path.dirname(id);
	const rel = path.basename(id);

	const edits: Edit[] = [];
	const heads = new Map<number, string[]>();
	calls.forEach((c, i) => {
		const where = `${rel}:${c.line}`;
		if (c.card) {
			const def = (cards ?? new Cards()).define(id, root, where, c.src, c.raw);
			watch(def.file);
			for (const f of def.fonts) watch(f.file);
			const name = `__og_card_${i}`;
			let list = heads.get(c.region);
			if (!list) heads.set(c.region, (list = []));
			list.push(`import ${name} from ${JSON.stringify(`${CARD_PREFIX}${def.name}`)};`);
			edits.push({ start: c.start, end: c.end, text: name });
			return;
		}
		const remote = is_url(c.src);
		if (remote && c.glob)
			throw new OgygiaError('image_option_invalid', {
				where,
				key: 'pattern',
				rule: "a pattern of local files: a remote image is one URL, import.meta.og.image('https://…')"
			});
		if (c.glob && (c.options.dark !== undefined || c.options.art !== undefined))
			throw new OgygiaError('image_option_invalid', {
				where: `${rel}:${c.line}`,
				key: c.options.dark !== undefined ? 'dark' : 'art',
				rule: 'given to one image: a glob matches many, and each needs its own twin file'
			});
		if (c.glob) {
			const matches = fs.globSync(c.src, { cwd: dir });
			if (!matches.length)
				throw new OgygiaError('image_glob_empty', { file: `${rel}:${c.line}`, pattern: c.src });
			const query = image_specifier('', c.options).slice(1);
			edits.push({
				start: c.start,
				end: c.end,
				text: `import.meta.glob(${JSON.stringify(c.src)}, { eager: true, import: 'default', query: ${JSON.stringify(`?${query}`)} })`
			});
			return;
		}
		const file = remote ? null : path.resolve(dir, c.src);
		const target = file === null ? remote_src(remote_url(where, c.src, hosts).href) : c.src;
		if (file !== null) {
			watch(file);
			if (!fs.existsSync(file))
				throw new OgygiaError('image_not_found', { file: where, src: c.src });
		}
		const twin = (src: string): string => {
			if (is_url(src))
				throw new OgygiaError('image_option_invalid', {
					where,
					key: src === c.options.dark ? 'dark' : 'art',
					rule: 'a path relative to this file: a twin is a file of the app'
				});
			const at = path.resolve(dir, src);
			watch(at);
			if (!fs.existsSync(at)) throw new OgygiaError('image_not_found', { file: where, src });
			if (file === null) return at.split(path.sep).join('/');
			const near = path.relative(path.dirname(file), at).split(path.sep).join('/');
			return near.startsWith('.') ? near : `./${near}`;
		};
		const options: ImageOptions = { ...c.options };
		if (options.dark !== undefined) options.dark = twin(options.dark);
		if (options.art !== undefined)
			options.art = Object.fromEntries(
				Object.entries(options.art).map(([media, src]) => [media, twin(src)])
			);
		const name = `__og_image_${i}`;
		let list = heads.get(c.region);
		if (!list) heads.set(c.region, (list = []));
		list.push(`import ${name} from ${JSON.stringify(image_specifier(target, options))};`);
		edits.push({ start: c.start, end: c.end, text: name });
	});
	for (const [at, lines] of heads)
		edits.push({ start: at, end: at, text: `\n${lines.join('\n')}\n` });
	return edits.sort((a, b) => a.start - b.start || (a.end === a.start ? -1 : 1));
}
