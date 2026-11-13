import { OgygiaError } from '../messages/core.ts';
import { OG_ORIGINS, OGYGIA_RUNTIME } from '../wire-markup.ts';

/** The runtime script's attribute naming the extra origins (space-separated). */
export const CODE_ORIGINS_ATTR: typeof OG_ORIGINS = OG_ORIGINS;

declare const CODE_URL: unique symbol;
/** A URL on an allowed code origin: only {@link code_url} makes one. */
export type CodeUrl = string & { readonly [CODE_URL]: true };

let origins: ReadonlySet<string> | null = null;

function origin_of(url: string, base?: string): string | null {
	try {
		const u = new URL(url, base ?? location.href);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
	} catch {
		return null; // ok: not a URL: no origin
	}
}

/** The allowed origins, read on the first ask (the runtime asks at boot: ./core.ts). */
export function code_origins(): ReadonlySet<string> {
	if (origins) return origins;
	const set = new Set<string>([location.origin]);
	const own = origin_of(import.meta.url);
	if (own) set.add(own);
	const script =
		typeof document === 'undefined'
			? null
			: document.head?.querySelector(`script[${OGYGIA_RUNTIME}]`);
	for (const named of (script?.getAttribute(CODE_ORIGINS_ATTR) ?? '').split(' ')) {
		const origin = named && origin_of(named);
		if (origin && origin === named) set.add(origin);
	}
	return (origins = set);
}

/** The runtime script now names the next response's origins: the next ask reads them as boot did. */
export function forget_code_origins(): void {
	origins = null;
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

// @why under a `'strict-dynamic'` CSP a trusted script's `import()` is trusted too, so the CSP never stops a URL that markup wrote (test: test/browser/code-origins.test.ts › is not imported as written: refused with its code, nothing requested)
/** The runtime's one `import()` of a computed URL: island code, a retry of its file, a dev region's
 *  styles. Nothing else in the runtime imports a URL it did not write (test/code-origins.test.ts). */
export function import_code<T>(url: CodeUrl): Promise<T> {
	return import(/* @vite-ignore */ url);
}

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
		return false; // ok: not URLs: neither is the other's location
	}
	if (id.origin !== loc.origin || code_url(loc.href) === null) return false;
	const iid = IDENTITY_FILE.exec(id.pathname)?.[1];
	return iid !== undefined && LOCATION_FILE.exec(loc.pathname)?.[1] === iid;
}
