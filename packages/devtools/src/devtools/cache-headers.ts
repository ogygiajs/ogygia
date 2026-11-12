import { all_regions, region_name } from './regions.ts';
import type { StylesFinding } from './styles.ts';
import { OGYGIA_RUNTIME, tool_fetch, tool_made } from '@ogygia/core/internal/instruments';

export interface CacheProbe {
	url: string;
	/** the island's name, or "the runtime" */
	name: string;
	cache_control: string | null;
	/** decoded bytes, when the browser loaded the file */
	bytes: number;
}

const MIN_MAX_AGE_S = 86_400;

/** Read one `cache-control`: whether it caches the file long enough to count (`immutable`, or a
 *  `max-age` of a day or more: shorter, and most return visits fetch it again). Split, not a regex. */
export function cached_long(cache_control: string | null): boolean {
	if (!cache_control) return false;
	let max_age = -1;
	let immutable = false;
	for (const raw of cache_control.toLowerCase().split(',')) {
		const d = raw.trim();
		if (d === 'no-store' || d === 'no-cache') return false;
		if (d === 'immutable') immutable = true;
		if (d.startsWith('max-age=')) max_age = Number(d.slice('max-age='.length));
	}
	return immutable ? max_age !== 0 : max_age >= MIN_MAX_AGE_S;
}

/** Every content-named file the page loads (the islands' locations, the runtime's), each once. */
export function content_named_files(doc: Document = document): { url: string; name: string }[] {
	const out = new Map<string, string>();
	const abs = (u: string) => new URL(u, doc.baseURI).href;
	for (const r of all_regions()) {
		const src = r.el.getAttribute('src');
		if (src && r.entry && src !== r.entry && !out.has(abs(src)))
			out.set(abs(src), region_name(r.entry));
	}
	const rt = doc.querySelector(`script[${OGYGIA_RUNTIME}]`)?.getAttribute('src');
	if (rt && !out.has(abs(rt))) out.set(abs(rt), 'the runtime');
	return [...out].map(([url, name]) => ({ url, name }));
}

/**
 * Ask the server how it caches each content-named file, at most `limit` files. In a build every
 * island's file and the runtime are named by their content (the region's `src`, the runtime script's
 * `src`), so the right cache for them is a year-long `immutable` one: a new build names new files. A
 * host that serves them `no-cache`, or with a short `max-age`, makes every returning visitor download
 * (or revalidate) them again. The browser's timing API does not expose response headers, so this
 * sends a HEAD request past the browser's cache for each. A file's bytes are the page's own load of
 * it, never an earlier probe's empty HEAD. Off a build (no `src`, or the `src` is the entry): nothing.
 * A file whose HEAD failed or was refused is left out: no answer says nothing about its caching.
 */
export async function probe_cache(doc: Document = document, limit = 40): Promise<CacheProbe[]> {
	const sizes = new Map<string, number>();
	for (const r of performance.getEntriesByType('resource') as PerformanceResourceTiming[])
		if (!tool_made(r)) sizes.set(r.name, r.decodedBodySize || 0);
	const files = content_named_files(doc).slice(0, limit);
	const probes = await Promise.all(
		files.map(async ({ url, name }): Promise<CacheProbe | null> => {
			let res: Response;
			try {
				res = await tool_fetch(url, { method: 'HEAD', cache: 'no-store' });
			} catch {
				return null; // ok: no answer, nothing known about the file's caching: it is left out
			}
			// (a refused HEAD, a 405 or a 404, carries the error page's headers, not the file's)
			if (!res.ok) return null;
			return {
				url,
				name,
				cache_control: res.headers.get('cache-control'),
				bytes: sizes.get(url) ?? 0
			};
		})
	);
	return probes.filter((p) => p !== null);
}

/** The finding: content-named files the host does not cache long, named heaviest first (the names
 *  that fit are the files a return visit pays most for), with the bytes at stake and each header
 *  seen named once (a host usually sends one policy for the whole directory). */
export function cache_findings(probes: readonly CacheProbe[]): StylesFinding[] {
	const short = probes.filter((p) => !cached_long(p.cache_control));
	if (!short.length) return [];
	const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
	const bytes = short.reduce((s, p) => s + p.bytes, 0);
	const seen = [...new Set(short.map((p) => p.cache_control ?? 'no cache-control'))].slice(0, 3);
	const names = [...new Set([...short].sort((a, b) => b.bytes - a.bytes).map((p) => p.name))];
	const list =
		names.length > 4
			? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more`
			: names.join(', ');
	return [
		{
			code: 'island-files-uncached',
			severity: 'warn',
			message: `${short.length} of the page's content-named files (${list}) are served with \`${seen.join('`, `')}\`: a returning visitor downloads${bytes ? ` ${kb(bytes)}` : ''} again (or waits to revalidate) on every visit. Their names change with their content, so they can be cached for good.`,
			fix: "Serve `_app/immutable/` with `cache-control: public, max-age=31536000, immutable` (SvelteKit's adapters do; a proxy, a CDN rule or a custom server in front can override it)."
		}
	];
}
