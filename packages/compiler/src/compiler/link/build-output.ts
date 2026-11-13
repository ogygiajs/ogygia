import fs from 'node:fs';
import path from 'node:path';
import { islandDepsHandoffPath } from './island-deps.ts';
import { WRITTEN_RELOCATIONS, relocate } from './relocations.ts';
import { OgygiaError, line } from '../messages.ts';

const SECRET_MODULE_RE = /[\\/](?:src|dist)[\\/]server[\\/](?:hmac|signing-key)\.[jt]s$/;

const ESCAPE_G = /\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|([\s\S]))/g;
const SINGLE_ESCAPES: Record<string, string> = {
	n: '\n',
	r: '\r',
	t: '\t',
	b: '\b',
	f: '\f',
	v: '\v',
	'0': '\0',
	'\n': ''
};

function unescaped(text: string): string {
	if (!text.includes('\\')) return text;
	return text.replace(ESCAPE_G, (_m, x?: string, cp?: string, u?: string, c?: string) => {
		if (x !== undefined) return String.fromCharCode(parseInt(x, 16));
		if (cp !== undefined) {
			const n = parseInt(cp, 16);
			return n <= 0x10ffff ? String.fromCodePoint(n) : '';
		}
		if (u !== undefined) return String.fromCharCode(parseInt(u, 16));
		return SINGLE_ESCAPES[c!] ?? c!;
	});
}

/**
 * SECRET-SPLIT, checked on the finished CLIENT bundle (internal/notes/INVARIANTS.md): no chunk or
 * asset holds a signing secret (`OGYGIA_SECRET`, the build's own key), and no chunk holds a module
 * that signs. Whatever put one there, the browser could then mint capabilities: the build fails.
 * `secrets` shorter than 16 characters are not looked for (too likely to match by chance; a
 * production `OGYGIA_SECRET` that short is refused earlier).
 */
export function refuse_client_secrets(
	bundle: Record<string, unknown>,
	secrets: readonly string[]
): void {
	const sought = secrets.filter((s) => s.length >= 16);
	for (const [key, out] of Object.entries(bundle)) {
		const o = out as {
			type?: string;
			fileName?: string;
			code?: string;
			source?: unknown;
			moduleIds?: string[];
		};
		const file = o.fileName ?? key;
		const text = o.type === 'chunk' ? o.code : typeof o.source === 'string' ? o.source : '';
		const read = text ? unescaped(text) : '';
		if (text && sought.some((s) => text.includes(s) || read.includes(s)))
			throw new OgygiaError('secret_in_client_chunk', { file, what: 'a signing secret' });
		const signer =
			o.type === 'chunk' ? o.moduleIds?.find((id) => SECRET_MODULE_RE.test(id)) : undefined;
		if (signer)
			throw new OgygiaError('secret_in_client_chunk', {
				file,
				what: `the server module ${path.basename(signer)}`
			});
	}
}

/**
 * Write the island-deps handoff JSON (the map SSR reads at render): the stable path under Kit's
 * `outDir` (`.svelte-kit` unless the app configured `kit.outDir`), an adapter-friendly copy next
 * to the server bundle, AND an in-place inline into every server chunk that carries the token slot
 * — inlining is what makes it survive serverless tracing (@vercel/nft only bundles *imported*
 * files, not runtime fs reads, so the co-located JSON is dropped there; that is why held/dual
 * regions that cross the wire rendered unstyled on Vercel/Netlify). Unpatched builds keep the fs
 * fallback (adapter-node, dev-preview).
 */
export function emit_island_deps_handoff(
	root: string,
	json: string,
	out_dir: string,
	counts: Map<string, number>
): void {
	const handoff = islandDepsHandoffPath(out_dir);
	fs.mkdirSync(path.dirname(handoff), { recursive: true });
	fs.writeFileSync(handoff, json);
	const server_copy = path.join(out_dir, 'output', 'server', 'og-region-deps.json');
	try {
		fs.mkdirSync(path.dirname(server_copy), { recursive: true });
		fs.writeFileSync(server_copy, json);
	} catch {
		// ok: the handoff path is enough for prerender
	}

	try {
		const server_dir = path.join(out_dir, 'output', 'server');
		const cx = { island_deps: json };
		const patch_server = (dir: string) => {
			let entries;
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				return; // ok: no server output here; the server reads the handoff file instead
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
					continue; // ok: an unpatched chunk keeps its token, and the server reads the handoff file
				}
				const patched = relocate(code, WRITTEN_RELOCATIONS, counts, cx);
				if (patched) fs.writeFileSync(full, patched.s.toString());
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
 *
 * @param reason_of a module (query-less id) → why its reads could not be pinned (the seed-shaping
 *   plugin's `why`)
 * @param file_of an entry's identity (the maps' key) → its emitted file; absent → the key is the
 *   file (a bundle from before content hashing)
 */
export function report_seed_shaping(
	map: { page: Record<string, boolean>; page_keys: Record<string, string[] | null> },
	bundle: Record<string, { type: string; moduleIds?: string[]; imports?: string[] }>,
	reason_of: (module: string) => { why: string; line: number | null } | null,
	root: string,
	file_of: (identity: string) => string = (identity) => identity
): Record<string, SeedWhy[]> {
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
					const r = reason_of(clean);
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
			lines.push(`  ${rel(file)}${r.line === null ? '' : `:${r.line}`} — ${r.why}`);
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
