/**
 * Whole-program build-output side effects — the work the adapter's `writeBundle` does AFTER the
 * client bundle is on disk: writing / inlining the island-deps handoff so SSR can `modulepreload` a
 * hydrate island's chunks and style a server-picked hole. Pure over the finished bundle + the app
 * root (fs is the only side effect); the adapter owns only the Vite `this.getFileName` resolution
 * and the trigger.
 */
import fs from 'node:fs';
import path from 'node:path';
import { islandDepsHandoffPath } from './island-deps.ts';
import { line } from '../messages.ts';

const BACKSLASH_G = /\\/g;
const SINGLE_QUOTE_G = /'/g;
const DOUBLE_QUOTE_G = /"/g;
const LINE_SEPARATOR_G = /\u2028/g;
const PARAGRAPH_SEPARATOR_G = /\u2029/g;

/**
 * Write the island-deps handoff JSON (the map SSR reads at render): the stable path under Kit's
 * `outDir` (`.svelte-kit` unless the app configured `kit.outDir`), an adapter-friendly copy next
 * to the server bundle, AND an in-place inline into every server chunk that carries the token slot
 * — inlining is what makes it survive serverless tracing (@vercel/nft only bundles *imported*
 * files, not runtime fs reads, so the co-located JSON is dropped there; that is why held/dual
 * regions that cross the wire rendered unstyled on Vercel/Netlify). Unpatched builds keep the fs
 * fallback (adapter-node, dev-preview).
 */
export function emit_island_deps_handoff(root: string, json: string, out_dir: string): void {
	const handoff = islandDepsHandoffPath(out_dir);
	fs.mkdirSync(path.dirname(handoff), { recursive: true });
	fs.writeFileSync(handoff, json);
	// Adapter-friendly copy next to the server bundle (Kit SSR out already exists).
	const server_copy = path.join(out_dir, 'output', 'server', 'og-region-deps.json');
	try {
		fs.mkdirSync(path.dirname(server_copy), { recursive: true });
		fs.writeFileSync(server_copy, json);
	} catch {
		// ok: the handoff path is enough for prerender
	}

	try {
		const server_dir = path.join(out_dir, 'output', 'server');
		const token = '__OGYGIA_ISLAND_DEPS_INLINE__';
		// Escape for BOTH quote styles: the SSR bundler may emit the slot in single OR double
		// quotes, and an escaped quote is valid in either literal — so this is safe regardless.
		const inline = json
			.replace(BACKSLASH_G, '\\\\')
			.replace(SINGLE_QUOTE_G, "\\'")
			.replace(DOUBLE_QUOTE_G, '\\"')
			.replace(LINE_SEPARATOR_G, '\\u2028')
			.replace(PARAGRAPH_SEPARATOR_G, '\\u2029');
		const patch_server = (dir: string) => {
			let entries;
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				const full = path.join(dir, e.name);
				if (e.isDirectory()) {
					patch_server(full);
					continue;
				}
				if (!e.name.endsWith('.js')) continue;
				let code;
				try {
					code = fs.readFileSync(full, 'utf8');
				} catch {
					continue;
				}
				if (!code.includes(token)) continue;
				fs.writeFileSync(full, code.split(token).join(inline));
			}
		};
		patch_server(server_dir);
	} catch {
		// ok: the fs fallback still serves adapter-node and preview
	}
}

/**
 * SEED SHAPING report (client `writeBundle`): which islands read `page.data` through the shim, how
 * many keys they were pinned to, and — the actionable part — the modules whose reads could not be
 * pinned, each with its line and why, since one such module makes every page carrying that island
 * ship its whole `page.data`. Same shape as the barrels report: a few lines, a count for the rest.
 */
export function report_seed_shaping(
	map: { page: Record<string, boolean>; page_keys: Record<string, string[] | null> },
	bundle: Record<string, { type: string; moduleIds?: string[]; imports?: string[] }>,
	program: { page_key_reasons: Map<string, { why: string; line: number | null }> },
	root: string,
	/** an entry's IDENTITY (the maps' key) → its emitted file (its location); absent → the key is
	 *  the file (a bundle from before content hashing) */
	file_of: (identity: string) => string = (identity) => identity
): Record<string, SeedWhy[]> {
	/** per island entry that ships all: the modules in its closure whose reads could not be pinned */
	const why_of: Record<string, SeedWhy[]> = {};
	const readers = Object.keys(map.page).filter((e) => map.page[e]);
	if (!readers.length) return why_of;
	const pinned = readers.filter((e) => Array.isArray(map.page_keys[e]));
	const unpinned = readers.filter((e) => !Array.isArray(map.page_keys[e]));
	const key_count = new Set(pinned.flatMap((e) => map.page_keys[e] ?? [])).size;
	const rel = (p: string) => (p.startsWith(root) ? p.slice(root.length).replace(/^\//, '') : p);
	const lines: string[] = [];
	lines.push(
		line('page_seed_report', {
			islands: readers.length,
			pinned: pinned.length,
			keys: key_count,
			unpinned: unpinned.length
		})
	);
	if (unpinned.length) {
		// The modules to blame: every recorded reason reachable from an unpinned island's closure.
		const closure = (entry: string): Set<string> => {
			const seen = new Set<string>();
			const queue = [file_of(entry).replace(/^\//, '')];
			while (queue.length) {
				const f = queue.pop()!;
				if (seen.has(f)) continue;
				seen.add(f);
				for (const i of bundle[f]?.imports ?? []) queue.push(i);
			}
			return seen;
		};
		const blamed = new Map<string, { why: string; line: number | null }>();
		for (const e of unpinned) {
			const own = new Set<string>();
			for (const chunk of closure(e)) {
				for (const id of bundle[chunk]?.moduleIds ?? []) {
					const clean = id.split('?')[0].split('\\').join('/');
					const r = program.page_key_reasons.get(clean);
					if (!r) continue;
					if (!blamed.has(clean)) blamed.set(clean, r);
					if (own.has(clean)) continue;
					own.add(clean);
					(why_of[e] ??= []).push({ file: rel(clean), line: r.line, why: r.why });
				}
			}
		}
		const rows = [...blamed].slice(0, 8);
		for (const [file, r] of rows)
			lines.push(`  ${rel(file)}${r.line === null ? '' : ':' + r.line} — ${r.why}`);
		if (blamed.size > rows.length)
			lines.push(
				`  … and ${blamed.size - rows.length} more module${blamed.size - rows.length === 1 ? '' : 's'}`
			);
		if (!blamed.size)
			lines.push(`  (read through code the build never saw — a dependency, or a foreign fragment)`);
	}
	console.log(lines.join('\n'));
	return why_of;
}

/** a module that made an island ship all of `page.data`: where (root-relative when inside the app)
 *  and why — what the profiler points at when the island's own file reads nothing whole */
export interface SeedWhy {
	file: string;
	line: number | null;
	why: string;
}
