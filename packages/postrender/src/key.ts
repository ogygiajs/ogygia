/** The store key for a request URL: the decoded pathname, verbatim (trailing slash preserved —
 *  `/fr/fr/` and `/fr/fr` are different documents to Kit and to the CDN). */
export function store_key(pathname: string): string {
	return pathname;
}

/** Whether `key` is in the subtree of a normalized prefix: the prefix itself or a page under it
 *  (`/fr/fr` holds `/fr/fr` and `/fr/fr/x`, never `/fr/fright`). */
export function in_subtree(key: string, normalized: string): boolean {
	return key === normalized || key.startsWith(subtree_prefix(normalized));
}

/** How many leading path segments become edge prefix tags (`p:/fr`, `p:/fr/fr`, `p:/fr/fr/x`).
 *  Depth-capped so tag counts stay bounded on deep trees; a purge deeper than the cap falls back
 *  to origin eviction + edge TTL. Shared by the akamai adapter and its emulator personality. */
export const PREFIX_TAG_DEPTH = 3;

/** Normalize a prefix filter: leading slash enforced, trailing slash stripped (except root). */
export function normalize_prefix(prefix: string): string {
	let p = prefix.startsWith('/') ? prefix : `/${prefix}`;
	while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
	return p;
}

/** The key prefix a normalized prefix's SUBTREE shares: `/fr/fr` → `/fr/fr/` (never `/fr/fright`),
 *  and the root `/` → `/` itself (every key; `'/' + '/'` would match nothing). */
export function subtree_prefix(normalized: string): string {
	return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

/** The depth-capped prefix list for a pathname — the edge tag vocabulary for this response. */
export function prefix_tags(pathname: string): string[] {
	const segs = pathname.split('/').filter(Boolean);
	const out: string[] = [];
	for (let i = 1; i <= Math.min(segs.length, PREFIX_TAG_DEPTH); i++) {
		out.push(`/${segs.slice(0, i).join('/')}`);
	}
	return out;
}
