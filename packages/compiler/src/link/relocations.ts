import path from 'node:path';
import {
	LATE_SERVER_REGIONS_TOKEN,
	PAGE_DATA_READS_TOKEN,
	SERVER_MAP_TOKENS,
	server_manifest_maps,
	server_regions,
	type ServerManifestMaps
} from './server-manifest.ts';
import MagicString from 'magic-string';
import { FILE_TOKEN_MARK, FILE_TOKEN_RE, file_token_id } from './file-token.ts';
import { ISLAND_DEPS_INLINE_TOKEN } from './island-deps.ts';
import { by_key } from './location-map.ts';
import type { Program } from '../program.ts';
import type { PageReadsSink } from '../ctx.ts';

const KIT_PAGE_MODULE_RE = /\/@sveltejs\/kit\/src\/runtime\/app\/(?:state|stores)(?:[/.]|$)/;

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const ANY_LITERAL_ESCAPE: ReadonlyMap<string, string> = new Map([
	['\\', '\\\\'],
	["'", "\\'"],
	['"', '\\"'],
	[LINE_SEPARATOR, '\\u2028'],
	[PARAGRAPH_SEPARATOR, '\\u2029']
]);
const LITERAL_ESCAPE: ReadonlyMap<string, string> = new Map([
	['\\', '\\\\'],
	['\n', '\\n'],
	['\r', '\\r'],
	[LINE_SEPARATOR, '\\u2028'],
	[PARAGRAPH_SEPARATOR, '\\u2029']
]);

function in_any_literal(text: string): string {
	let out = '';
	for (const c of text) out += ANY_LITERAL_ESCAPE.get(c) ?? c;
	return out;
}

function relative_file(from: string, to: string): string {
	const up = from.split('/').slice(0, -1);
	const down = to.split('/');
	while (up.length && down.length > 1 && up[0] === down[0]) {
		up.shift();
		down.shift();
	}
	return up.length ? `${'../'.repeat(up.length)}${down.join('/')}` : `./${down.join('/')}`;
}

/** A module as the bundler's graph knows it. */
export type GraphInfo = {
	importedIds: readonly string[];
	dynamicallyImportedIds: readonly string[];
} | null;

/** What a relocation's value is made from: the final records and the finished graph. */
export interface RelocateCx {
	readonly program: Program;
	/** A region's public URL, the key its CSS is handed off under. */
	public_url(iid: string): string;
	/** The leg's late server regions' chunk refs, by island id. */
	readonly late_server_regions: ReadonlyMap<string, string>;
	/** The chunk being finished, and an emitted chunk's file name by its ref. */
	readonly chunk_file: string;
	file_name(ref: string): string;
	/** The file of the chunk a module is the facade of (its own chunk), if it has one. */
	facade_file(id: string): string | undefined;
	graph(id: string): GraphInfo;
	module_ids(): Iterable<string>;
	/** The seed-shaping plugin's answers (`dataShake()`); null when none is listed, and then every
	 *  hole looks the page up. */
	readonly page_reads: Pick<PageReadsSink, 'keys'> | null;
}

export interface Relocation<Cx = RelocateCx> {
	readonly name: string;
	/** The text in a chunk that stands for the value (or begins it, with `pattern`). */
	readonly token: string;
	/** A token that carries its own part (a module id): each match is replaced whole; group 1 is the
	 *  quote around it, group 2 its part. Without one the token is the whole match. */
	readonly pattern?: RegExp;
	/** Only a server leg's chunks carry it. */
	readonly server_only: boolean;
	/** A chunk it patched hands on a map of the patch. Left out: the chunk's map passes as it was
	 *  given, as these patches always did (one map through every pass is report step 13). */
	readonly mapped?: true;
	/** The value, once per chunk, then per token: `quote` is the character before the token (a token
	 *  inside a string literal is escaped for that literal's quote), or the pattern's quote; `part` is
	 *  the pattern's part (`''` without one). */
	value(cx: Cx): (quote: string, part: string) => string;
}

const PAGE_DATA_READS: Relocation = {
	name: 'page data reads',
	token: PAGE_DATA_READS_TOKEN,
	server_only: true,
	value(cx) {
		const page_reads = cx.page_reads;
		if (!page_reads) return () => 'null';
		const clean = (id: string) => id.split('?')[0].split('\\').join('/');
		const imports_kit_page = (ids: readonly string[]) =>
			ids.some((d) => KIT_PAGE_MODULE_RE.test(clean(d)));
		const reads_itself = (id: string, info: GraphInfo) => {
			const c = clean(id);
			const k = page_reads.keys(c);
			if (k !== null) return k === 'unknown' || k.size > 0;
			if (KIT_PAGE_MODULE_RE.test(c)) return false;
			return (
				!!info &&
				(imports_kit_page(info.importedIds) || imports_kit_page(info.dynamicallyImportedIds))
			);
		};
		const ids_by_path = new Map<string, string>();
		for (const id of cx.module_ids()) if (!id.startsWith('\0')) ids_by_path.set(clean(id), id);
		const proven_clean = new Set<string>();
		const reads = (root: string): boolean => {
			const seen = new Set<string>([root]);
			const queue = [root];
			for (let i = 0; i < queue.length; i++) {
				const id = queue[i];
				if (proven_clean.has(id)) continue;
				const info = cx.graph(id);
				if (reads_itself(id, info)) return true;
				if (!info) continue;
				for (const next of info.importedIds)
					if (!seen.has(next)) {
						seen.add(next);
						queue.push(next);
					}
				for (const next of info.dynamicallyImportedIds)
					if (!seen.has(next)) {
						seen.add(next);
						queue.push(next);
					}
			}
			for (const id of seen) proven_clean.add(id);
			return false;
		};
		const out: Record<string, boolean> = {};
		for (const [iid, , reg] of server_regions(cx.program)) {
			const root = reg.componentPath ? ids_by_path.get(clean(reg.componentPath)) : undefined;
			out[iid] = root === undefined ? true : reads(root);
		}
		const json = JSON.stringify(out);
		return (quote) => in_literal(json, quote);
	}
};

function in_literal(text: string, quote: string): string {
	let out = '';
	for (const c of text)
		out += c === quote || (quote === '`' && c === '$') ? `\\${c}` : (LITERAL_ESCAPE.get(c) ?? c);
	return out;
}

const server_map = (name: keyof ServerManifestMaps): Relocation => ({
	name: `server ${name}`,
	token: SERVER_MAP_TOKENS[name],
	server_only: true,
	value(cx) {
		const json = JSON.stringify(
			server_manifest_maps(cx.program, (iid) => cx.public_url(iid))[name]
		);
		return (quote) => in_literal(json, quote);
	}
});

const LATE_SERVER_REGIONS: Relocation = {
	name: 'late server regions',
	token: LATE_SERVER_REGIONS_TOKEN,
	server_only: true,
	value(cx) {
		const from = path.posix.dirname(cx.chunk_file);
		const late = [...cx.late_server_regions].sort(by_key);
		const loaders = late.map(([iid, ref]) => {
			const rel = path.posix.relative(from, cx.file_name(ref));
			const spec = rel.startsWith('.') ? rel : `./${rel}`;
			return `${JSON.stringify(iid)}: () => import(${JSON.stringify(spec)})`;
		});
		const object = `{${loaders.join(', ')}}`;
		return () => object;
	}
};

/**
 * Each lazy loader's own file (vite/lazy-files.ts): the path from the chunk being finished to the
 * module's own chunk, or `null` when it has none (it shares a chunk with others: the bundler reads
 * it out of that chunk's exports, which a plain import of the file would not).
 */
export const FILE: Relocation = {
	name: 'lazy loader file',
	token: FILE_TOKEN_MARK,
	pattern: FILE_TOKEN_RE,
	server_only: false,
	mapped: true,
	value(cx) {
		return (_quote, hex) => {
			const file = cx.facade_file(file_token_id(hex));
			return file === undefined ? 'null' : JSON.stringify(relative_file(cx.chunk_file, file));
		};
	}
};

/**
 * Values known only at the end of a leg. A virtual module loads before the bundler has transformed
 * every module, so a value that needs every transform (which holes read `page.data`) is written as
 * a token, and each finished chunk has its tokens replaced at renderChunk from the final records.
 * A token is a string or an expression the bundler keeps, never a comment, which it drops before
 * renderChunk. This table is every such token. A leg whose output still holds a token is said
 * (`relocation_unpatched`). One value comes from a later leg: {@link WRITTEN_RELOCATIONS}.
 */
export const RELOCATIONS: readonly Relocation[] = [
	PAGE_DATA_READS,
	server_map('region_url'),
	server_map('region_name'),
	server_map('region_render'),
	server_map('render_region'),
	LATE_SERVER_REGIONS,
	FILE
];

/** What the client leg's handoff makes: the island deps JSON. */
export interface WrittenCx {
	readonly island_deps: string;
}

const ISLAND_DEPS: Relocation<WrittenCx> = {
	name: 'island deps',
	token: ISLAND_DEPS_INLINE_TOKEN,
	server_only: true,
	value(cx) {
		const inline = in_any_literal(cx.island_deps);
		return () => inline;
	}
};

/** The values a later leg writes into this leg's files after they were written. */
export const WRITTEN_RELOCATIONS: readonly Relocation<WrittenCx>[] = [ISLAND_DEPS];

/** The relocations a leg's chunks carry. */
export const relocations_of = (server: boolean): readonly Relocation[] =>
	server ? RELOCATIONS : RELOCATIONS.filter((r) => !r.server_only);

/**
 * Replace every token of `table` in a finished chunk (each found in the chunk as it was given),
 * counting each patch into `counts` (by name). `null` when the chunk carries none. `mapped`: a
 * `mapped` relocation patched it.
 */
export function relocate<Cx>(
	code: string,
	table: readonly Relocation<Cx>[],
	counts: Map<string, number>,
	cx: Cx
): { s: MagicString; mapped: boolean } | null {
	let s: MagicString | null = null;
	let mapped = false;
	for (const r of table) {
		if (!code.includes(r.token)) continue;
		const value = r.value(cx);
		let n = 0;
		const patch = (start: number, end: number, text: string) => {
			s ??= new MagicString(code);
			mapped ||= r.mapped === true;
			if (text) s.overwrite(start, end, text);
			else s.remove(start, end);
			n++;
		};
		if (r.pattern)
			for (const m of code.matchAll(r.pattern))
				patch(m.index, m.index + m[0].length, value(m[1], m[2]));
		else
			for (
				let at = code.indexOf(r.token);
				at !== -1;
				at = code.indexOf(r.token, at + r.token.length)
			)
				patch(at, at + r.token.length, value(code[at - 1] ?? '', ''));
		if (n) counts.set(r.name, (counts.get(r.name) ?? 0) + n);
	}
	return s === null ? null : { s, mapped };
}

/** A relocation a leg's output left unpatched: a chunk still holds its token. */
export function unpatched(server: boolean, chunks: Iterable<{ code: string }>): Relocation[] {
	const left = new Set<Relocation>();
	const own = relocations_of(server);
	for (const chunk of chunks) for (const r of own) if (chunk.code.includes(r.token)) left.add(r);
	return own.filter((r) => left.has(r));
}
