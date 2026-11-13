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
import { PAGE_DATA_READS_TOKEN } from './server-manifest.ts';
import type { Program } from '../program.ts';

/** A module as the bundler's graph knows it. */
export type GraphInfo = {
	importedIds: readonly string[];
	dynamicallyImportedIds: readonly string[];
} | null;

/** What a relocation's value is made from: the final records and the finished graph. */
export interface RelocateCx {
	readonly program: Program;
	readonly dollar_hoists: ReadonlyMap<string, string>;
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
		const regs = [...cx.dollar_hoists.entries()]
			.map(([tag, src]) => `globalThis.__og_reg_fn(${JSON.stringify(tag)}, (${src}));`)
			.join('\n');
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
		const { page_keys, page_pending, by_id, registry } = cx.program;
		const clean = (id: string) => id.split('?')[0].split('\\').join('/');
		const reads_itself = (id: string) => {
			const c = clean(id);
			const k = page_keys.get(c);
			return (k !== undefined && (k === 'all' || k.size > 0)) || page_pending.has(c);
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
				if (reads_itself(id)) return true;
				const info = cx.graph(id);
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
		for (const [iid, virtual_path] of by_id) {
			const reg = registry.get(virtual_path);
			if (!reg?.server) continue;
			const root = reg.componentPath ? ids_by_path.get(clean(reg.componentPath)) : undefined;
			// (a component the graph does not know: unknown, so it looks up: a wrong `false` would
			// render a hole with an empty page.data)
			out[iid] = root === undefined ? true : reads(root);
		}
		// the token sits in a string literal the bundler may have re-quoted: escape for that quote (the
		// JSON is ids and booleans only: its one special character is `"`)
		const json = JSON.stringify(out);
		const escaped = json.split('"').join('\\"');
		return (quote) => (quote === '"' ? escaped : json);
	}
};

export const RELOCATIONS: readonly Relocation[] = [FN_MANIFEST, PAGE_DATA_READS];

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
