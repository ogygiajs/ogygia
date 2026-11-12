/**
 * `pageKeys()`: seed shaping, listed beside `ogygia()`
 * (`plugins: [ogygia(), pageKeys(), sveltekit()]`).
 *
 * An island that reads `page.data` through `$app/state` / `$app/stores` gets the page seed. Without
 * this plugin that seed is all of `page.data`, and every server hole looks it up. With it, the build
 * reads each module once (./analysis.ts) for the top-level `page.data` keys it can reach; the page
 * ships only the keys its islands read, and a hole whose tree reads none skips the lookup. Any read
 * the analysis cannot pin answers `'unknown'`, and that region gets all of `page.data` as before.
 */
import { definePlugin, type OgygiaPlugin, type PageReads } from '@ogygia/compiler/vite';
import {
	follow_pending_page_calls,
	mentions_page_store,
	page_data_keys_answer,
	read_file_sync,
	summarize_export,
	type AllReason,
	type PageKeys,
	type PendingCall
} from './analysis.ts';

const SCRIPT_MODULE_RE = /\.(?:[cm]?[jt]sx?)$/;

/** The seed-shaping plugin. */
export function pageKeys(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/page-keys',
		build(b) {
			b.pageReads(page_reads());
		}
	});
}

/** One build's answers (a plugin instance per configured `ogygia()`: Kit 2 builds each leg in its
 *  own). `read` is the build's file reader, threaded in so this stays testable. */
export function page_reads(read: (file: string) => string | null = read_file_sync): PageReads {
	const state = {
		/** per module, the keys it reads (`'all'`: a read could not be pinned) */
		page_keys: new Map<string, PageKeys>(),
		/** per module that answered `'all'`: why, and on which line */
		page_key_reasons: new Map<string, AllReason>(),
		/** per module, the `helper(page)` calls into imported helpers that `settle` follows */
		page_pending: new Map<string, PendingCall[]>()
	};
	const kind_of = (id: string): 'svelte' | 'script' => (id.endsWith('.svelte') ? 'svelte' : 'script');
	return {
		module(id, code) {
			if (!mentions_page_store(code)) return;
			if (!id.endsWith('.svelte') && !SCRIPT_MODULE_RE.test(id)) return;
			const { keys, reason, pending } = page_data_keys_answer(code, id, kind_of(id));
			if (keys !== null) state.page_keys.set(id, keys);
			if (reason) state.page_key_reasons.set(id, reason);
			if (pending.length) state.page_pending.set(id, pending);
			else state.page_pending.delete(id);
		},
		settle: (resolve) => follow_pending_page_calls(state, resolve, read),
		keys(id) {
			// a helper call not followed yet: what it reads is not known
			if (state.page_pending.has(id)) return 'unknown';
			const k = state.page_keys.get(id);
			return k === undefined ? null : k === 'all' ? 'unknown' : k;
		},
		why: (id) => state.page_key_reasons.get(id) ?? null,
		async dev(files, resolve) {
			const read_keys = new Set<string>();
			let all = false;
			let any = false;
			const why: { file: string; line: number | null; why: string }[] = [];
			const add = (k: PageKeys | null) => {
				if (k === null) return;
				any = true;
				if (k === 'all') all = true;
				else for (const x of k) read_keys.add(x);
			};
			for (const f of files) {
				const code = read(f);
				if (!code) continue;
				const a = page_data_keys_answer(code, f, kind_of(f));
				if (a.keys === 'all' && a.reason)
					why.push({ file: f, line: a.reason.line, why: a.reason.why });
				add(a.keys);
				// `helper(page)`: what the imported helper reads of it (one level)
				for (const p of a.pending) {
					const target = (await resolve(p.specifier, f))?.id;
					const tcode = target ? read(target) : null;
					const s = tcode
						? summarize_export(tcode, target!, kind_of(target!), p.imported, p.arg)
						: 'all';
					if (s === 'all' || !(s instanceof Set)) {
						why.push({
							file: f,
							line: p.line,
							why: `the page is handed to ${p.imported}(), which the analysis cannot follow`
						});
						add('all');
					} else add(s);
				}
			}
			return { keys: !any ? null : all ? 'unknown' : [...read_keys], why };
		}
	};
}
