import { fnv1a32 } from '@ogygia/core/plugin/utils';
import type { PostrenderMeta } from './types.ts';

/** The store key for a request URL: the decoded pathname, verbatim (trailing slash preserved —
 *  `/fr/fr/` and `/fr/fr` are different documents to Kit and to the CDN). */
export function store_key(pathname: string): string {
	return pathname;
}

/** Store key for a variant-keyed page entry under `pathname`. */
export function variant_store_key(
	pathname: string,
	variants: ReadonlyArray<readonly [string, string]>
): string {
	const suffix = variants.map(([k, v]) => `${k}=${v}`).join('&');
	return `${pathname}\0v:${suffix}`;
}

/** Whether `key` is in the subtree of a normalized prefix: the prefix itself, a variant key of it,
 *  or a page under it (`/fr/fr` holds `/fr/fr` and `/fr/fr/x`, never `/fr/fright`). */
export function in_subtree(key: string, normalized: string): boolean {
	return (
		key === normalized ||
		key.startsWith(`${normalized}\0`) ||
		key.startsWith(subtree_prefix(normalized))
	);
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

const AKAMAI_TAG_DISALLOWED_G = /[^A-Za-z0-9!#$%'+./^_`|~-]/g;
const AKAMAI_TAG_MAX_LEN = 128;
export const AKAMAI_MAX_TAGS = 128;

/** Sanitize a string into an Akamai-legal Edge-Cache-Tag token (no colons/spaces, <= 128 chars). */
export function akamai_tag(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return '';
	return trimmed.replace(AKAMAI_TAG_DISALLOWED_G, '_').slice(0, AKAMAI_TAG_MAX_LEN);
}

/** Akamai prefix tag for a normalized prefix (`/fr/fr` -> `og_p/fr/fr`, `/` -> `og_p`). */
export function akamai_prefix_tag(normalized: string): string {
	return normalized === '/' ? 'og_p' : akamai_tag(`og_p${normalized}`);
}

/** Akamai URL tag for a pathname (`og_u_<fnv1a32>`), used to purge all variant ARLs atomically. */
export function akamai_url_tag(pathname: string): string {
	return `og_u_${fnv1a32(pathname)}`;
}

/** Map an internal or app cache tag (`s:...`, `b:...`, `p:...`, or plain tag) to an Akamai-legal tag. */
export function akamai_external_tag(tag: string): string {
	const trimmed = tag.trim();
	if (!trimmed) return '';
	if (trimmed.startsWith('p:')) return akamai_prefix_tag(normalize_prefix(trimmed.slice(2)));
	if (trimmed.startsWith('s:') || trimmed.startsWith('b:'))
		return `og_${trimmed[0]}_${fnv1a32(trimmed)}`;
	return akamai_tag(trimmed);
}

/** Build the deduplicated, sanitized edge cache-tag list for `meta`, reserving structural tags. */
export function build_edge_tags(
	meta: PostrenderMeta,
	max_tags: number = AKAMAI_MAX_TAGS
): string[] {
	const structural = new Set<string>();
	for (const p of prefix_tags(meta.url)) structural.add(akamai_prefix_tag(p));
	structural.add(akamai_url_tag(meta.url));
	for (const [name, variant] of meta.variants ?? []) {
		structural.add(akamai_tag(`og_flag_${name}`));
		structural.add(akamai_tag(`og_exp_${name}_${variant}`));
	}
	const app_budget = Math.max(0, max_tags - structural.size);
	const app_set = new Set<string>();
	for (const raw of meta.tags ?? []) {
		if (app_set.size >= app_budget) break;
		const clean = akamai_external_tag(raw);
		if (clean && !structural.has(clean)) app_set.add(clean);
	}
	return [...app_set, ...structural].slice(0, max_tags);
}
