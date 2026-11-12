/**
 * CODE ORIGINS — where island code may load from: the page's own origin, the runtime's (Kit's
 * `paths.assets`, where every built file lives), and the origins the server wrote on the runtime's
 * script (`data-og-origins`: a federation peer's, server/document-tail.ts). Nowhere else.
 *
 * A region's `entry` and `src` are markup. Markup that came in some other way (a rich-text field, a
 * sanitizer that keeps custom elements and unknown attributes) must not become script from any
 * origin: hole HTML is held to its own origin for the same reason (INVARIANTS HOLE-TRUST), and under
 * a `'strict-dynamic'` CSP the runtime's `import()` is trusted, so the CSP would not stop it.
 *
 * Read once per document, from the first runtime script in the head (the server's, before any
 * markup a page adds later), and never widened. A {@link CodeUrl} is made only here, and
 * {@link import_code}, the runtime's one computed `import()`, takes nothing else: an island's load,
 * its warm and its preload links, and the dev region-css rescue all ask here (#981).
 * test/browser/code-origins.test.ts.
 *
 * A leaf: island-side code (./entry-locations.ts) imports it.
 */
// (the boot's own table: this module is boot code, test/runtime-boot-svelte-free.test.ts)
import { OgygiaError } from '../messages/core.ts';

/** The runtime script's attribute naming the extra origins (space-separated). */
export const CODE_ORIGINS_ATTR = 'data-og-origins';

declare const CODE_URL: unique symbol;
/** A URL on an allowed code origin: only {@link code_url} makes one. */
export type CodeUrl = string & { readonly [CODE_URL]: true };

let origins: ReadonlySet<string> | null = null;

function origin_of(url: string, base?: string): string | null {
	try {
		const u = new URL(url, base ?? location.href);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
	} catch {
		return null;
	}
}

/** The allowed origins, read on the first ask (the runtime asks at boot: ./core.ts). */
export function code_origins(): ReadonlySet<string> {
	if (origins) return origins;
	const set = new Set<string>([location.origin]);
	const own = origin_of(import.meta.url);
	if (own) set.add(own);
	// the FIRST runtime script, attribute or not: with none on the server's, a later one is markup's
	// (test/browser/property-code-origins.test.ts)
	const script =
		typeof document === 'undefined'
			? null
			: document.head?.querySelector('script[data-ogygia-runtime]');
	for (const named of (script?.getAttribute(CODE_ORIGINS_ATTR) ?? '').split(' ')) {
		const origin = named && origin_of(named);
		if (origin && origin === named) set.add(origin);
	}
	return (origins = set);
}

/** `url` (resolved against `base`, else the page) when it is on an allowed code origin, else null. */
export function code_url(url: string, base?: string): CodeUrl | null {
	const origin = origin_of(url, base);
	return origin !== null && code_origins().has(origin) ? (url as CodeUrl) : null;
}

/** `url` as a {@link CodeUrl}, or the refusal the loader rejects with. */
export function code_url_or_refuse(url: string, entry: string = url): CodeUrl {
	const ok = code_url(url);
	if (ok === null) throw new OgygiaError('island_code_refused', { url, entry });
	return ok;
}

/** The runtime's one `import()` of a computed URL: island code, a retry of its file, a dev region's
 *  styles. Nothing else in the runtime imports a URL it did not write (test/code-origins.test.ts). */
export function import_code<T>(url: CodeUrl): Promise<T> {
	return import(/* @vite-ignore */ url);
}

// ── a location is the same island's built file ──────────────────────────────────────────────
/** A build's island identity's file (`…/og-region.<iid>.js`) and its location's
 *  (`…/og-region.<iid>.<hash>.js`, compiler/driver.ts `entry_file_pattern`). */
const IDENTITY_FILE = /\/og-region\.([\w-]+)\.js$/;
const LOCATION_FILE = /\/og-region\.([\w-]+)\.[\w-]+\.js$/;

/**
 * Whether `location` can be `identity`'s file: the same island's built file, on the identity's own
 * origin, and that origin allowed. Anything else (another origin, another island's file, any other
 * file of the page's origin) would let one element's `src` re-point the code of every region with
 * that identity. Both absolute.
 */
export function is_location_of(identity: string, location: string): boolean {
	let id: URL, loc: URL;
	try {
		id = new URL(identity);
		loc = new URL(location);
	} catch {
		return false;
	}
	if (id.origin !== loc.origin || code_url(loc.href) === null) return false;
	const iid = IDENTITY_FILE.exec(id.pathname)?.[1];
	return iid !== undefined && LOCATION_FILE.exec(loc.pathname)?.[1] === iid;
}
