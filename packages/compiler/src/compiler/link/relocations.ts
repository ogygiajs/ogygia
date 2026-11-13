/**
 * VALUES KNOWN ONLY AT THE END OF A LEG: RELOCATIONS. A virtual module loads before the bundler has
 * transformed every module, so a value that needs every transform (the `og.$` factories, which holes
 * read `page.data`) is written as a token, and each finished chunk has its tokens replaced at
 * renderChunk from the final records. This table is every such token: what stands for it, which
 * legs carry it, the module that writes it, and how its value is made. The patches are counted per
 * leg, and a leg whose output still holds a token, or whose bundle holds a carrier no chunk was
 * patched for, is said (`relocation_unpatched`, test/relocations.test.ts).
 */
import { V_FN_MANIFEST } from '../ids.ts';
import path from 'node:path';
import {
	LATE_SERVER_REGIONS_TOKEN,
	PAGE_DATA_READS_TOKEN,
	SERVER_MAP_TOKENS,
	server_manifest_maps,
	server_regions,
	type ServerManifestMaps
} from './server-manifest.ts';
import type { Program } from '../program.ts';
import { fn_manifest_registrations } from '../macros/dollar.ts';

/** Kit's page modules, where the alias sends `$app/state` and `$app/stores`. */
const KIT_PAGE_MODULE_RE = /\/@sveltejs\/kit\/src\/runtime\/app\/(?:state|stores)(?:[/.]|$)/;

/** A module as the bundler's graph knows it. */
export type GraphInfo = {
	importedIds: readonly string[];
	dynamicallyImportedIds: readonly string[];
} | null;

/** What a relocation's value is made from: the final records and the finished graph. */
export interface RelocateCx {
	readonly program: Program;
	readonly dollar_hoists: ReadonlyMap<string, string>;
	/** A region's public URL, the key its CSS is handed off under. */
	public_url(iid: string): string;
	/** The leg's late server regions' chunk refs, by island id. */
	readonly late_server_regions: ReadonlyMap<string, string>;
	/** The chunk being finished, and an emitted chunk's file name by its ref. */
	readonly chunk_file: string;
	file_name(ref: string): string;
	graph(id: string): GraphInfo;
	module_ids(): Iterable<string>;
}

export interface Relocation {
	readonly name: string;
	/** The text in a chunk that stands for the value. */
	readonly token: string;
	/** Only a server leg's chunks carry it. */
	readonly server_only: boolean;
	/** The resolved id of the virtual module that writes the token where the token cannot be shaken
	 *  out of its chunk (a statement of a module with side effects); `null` for an export the bundler
	 *  may drop when nothing reads it. */
	readonly carrier: string | null;
	/** The value, once per chunk; `quote` is the character before the token (a token inside a string
	 *  literal is escaped for that literal's quote). */
	value(cx: RelocateCx): (quote: string) => string;
}

/**
 * The fn-manifest's `og.$` factory registrations, through the globalThis bridge the placeholder
 * module installed (rename-proof under minification).
 */
const FN_MANIFEST: Relocation = {
	name: 'fn manifest',
	token: '/*__OGYGIA_FN_MANIFEST__*/',
	server_only: false,
	carrier: `\0${V_FN_MANIFEST}`,
	value(cx) {
		const regs = fn_manifest_registrations(cx.dollar_hoists);
		return () => regs;
	}
};

/**
 * The server manifest's page-data answer: per server island (a hole), does its SERVER tree (the
 * component and everything it imports, statically or dynamically: a registry's blocks) read
 * `page.data`? The transform recorded each module's reads (`page_keys`, seed shaping). A hole that
 * never reads it never pays the page lookup (server/render-page.ts). One walk per hole, sharing what
 * earlier walks proved: a walk that ends with no reader proves every module it visited reads nothing.
 */
const PAGE_DATA_READS: Relocation = {
	name: 'page data reads',
	token: PAGE_DATA_READS_TOKEN,
	server_only: true,
	carrier: null,
	value(cx) {
		const { page_keys, page_pending } = cx.program;
		const clean = (id: string) => id.split('?')[0].split('\\').join('/');
		const imports_kit_page = (ids: readonly string[]) =>
			ids.some((d) => KIT_PAGE_MODULE_RE.test(clean(d)));
		const reads_itself = (id: string, info: GraphInfo) => {
			const c = clean(id);
			const k = page_keys.get(c);
			if (k !== undefined) return k === 'all' || k.size > 0 || page_pending.has(c);
			if (page_pending.has(c)) return true;
			// Kit's page module is what is read: its own halves (`state/server.js`) are not a reader
			if (KIT_PAGE_MODULE_RE.test(c)) return false;
			// a page reader seed shaping could not read (a barrel, `getStores()`, an `import()`): unknown
			return (
				!!info &&
				(imports_kit_page(info.importedIds) || imports_kit_page(info.dynamicallyImportedIds))
			);
		};
		// a component path → the graph's id for it (a graph id may carry a query or another separator)
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
			// (a component the graph does not know: unknown, so it looks up: a wrong `false` would
			// render a hole with an empty page.data)
			out[iid] = root === undefined ? true : reads(root);
		}
		// (the token sits in a string literal the bundler may have re-quoted)
		const json = JSON.stringify(out);
		return (quote) => in_literal(json, quote);
	}
};

/** `text` as the inside of a string literal quoted with `quote` (a bundler may re-quote one). */
function in_literal(text: string, quote: string): string {
	let out = '';
	for (const c of text)
		out +=
			c === '\\' || c === quote || (quote === '`' && c === '$')
				? `\\${c}`
				: c === '\n'
					? '\\n'
					: c === '\r'
						? '\\r'
						: c === ' '
							? '\\u2028'
							: c === ' '
								? '\\u2029'
								: c;
	return out;
}

/** One of the server manifest's maps, from the final registry (link/server-manifest.ts, #1420). */
const server_map = (name: keyof ServerManifestMaps): Relocation => ({
	name: `server ${name}`,
	token: SERVER_MAP_TOKENS[name],
	server_only: true,
	carrier: null,
	value(cx) {
		const json = JSON.stringify(
			server_manifest_maps(cx.program, (iid) => cx.public_url(iid))[name]
		);
		return (quote) => in_literal(json, quote);
	}
});

/** The loaders of the server regions found after `server-regions` was written: each its own
 *  emitted chunk, imported by its path from the chunk being finished. */
const LATE_SERVER_REGIONS: Relocation = {
	name: 'late server regions',
	token: LATE_SERVER_REGIONS_TOKEN,
	server_only: true,
	carrier: null,
	value(cx) {
		const from = path.posix.dirname(cx.chunk_file);
		// (sorted by id, as every server region list: test/server-manifest-late-order.test.ts)
		const late = [...cx.late_server_regions].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		const loaders = late.map(([iid, ref]) => {
			const rel = path.posix.relative(from, cx.file_name(ref));
			const spec = rel.startsWith('.') ? rel : `./${rel}`;
			return `${JSON.stringify(iid)}: () => import(${JSON.stringify(spec)})`;
		});
		const object = `{${loaders.join(', ')}}`;
		return () => object;
	}
};

export const RELOCATIONS: readonly Relocation[] = [
	FN_MANIFEST,
	PAGE_DATA_READS,
	server_map('region_url'),
	server_map('region_name'),
	server_map('region_render'),
	server_map('render_region'),
	LATE_SERVER_REGIONS
];

/** The relocations a leg's chunks carry. */
export const relocations_of = (server: boolean): readonly Relocation[] =>
	server ? RELOCATIONS : RELOCATIONS.filter((r) => !r.server_only);

/**
 * Replace every relocation token in a finished chunk, counting each patch into `counts` (by name).
 * `null` when the chunk carries none.
 */
export function relocate(
	code: string,
	server: boolean,
	counts: Map<string, number>,
	cx: RelocateCx
): string | null {
	let out = code;
	for (const r of relocations_of(server)) {
		let at = out.indexOf(r.token);
		if (at === -1) continue;
		const value = r.value(cx);
		let patched = '';
		let from = 0;
		let n = 0;
		for (; at !== -1; at = out.indexOf(r.token, from)) {
			patched += out.slice(from, at) + value(out[at - 1] ?? '');
			from = at + r.token.length;
			n++;
		}
		out = patched + out.slice(from);
		counts.set(r.name, (counts.get(r.name) ?? 0) + n);
	}
	return out === code ? null : out;
}

/** A relocation a leg's output left unpatched: a chunk still holds its token, or the bundle holds
 *  its carrier and no chunk was patched for it. */
export function unpatched(
	server: boolean,
	counts: ReadonlyMap<string, number>,
	chunks: Iterable<{ code: string; moduleIds: readonly string[] }>
): Relocation[] {
	const left = new Set<Relocation>();
	const carried = new Set<Relocation>();
	const own = relocations_of(server);
	for (const chunk of chunks)
		for (const r of own) {
			if (chunk.code.includes(r.token)) left.add(r);
			if (r.carrier !== null && chunk.moduleIds.includes(r.carrier)) carried.add(r);
		}
	for (const r of carried) if (!counts.get(r.name)) left.add(r);
	return own.filter((r) => left.has(r));
}
