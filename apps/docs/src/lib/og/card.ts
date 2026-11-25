/** What one share image shows: the homepage card, or a title with an optional section chip. */
export type Card = { home: true } | { home?: false; title: string; category?: string };

const PREFIX = '/og/';
const SUFFIX = '.png';

/** The base64url text of `s`'s UTF-8 bytes. */
function to_base64url(s: string): string {
	let bin = '';
	for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function from_base64url(s: string): string {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
	return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The file name part of a card's image: one path segment, whatever the title holds. */
export function card_key(card: Card): string {
	const parts = card.home ? ['home'] : ['page', card.title, card.category ?? ''];
	return to_base64url(JSON.stringify(parts));
}

/** The site path of a card's image (`/og/<key>.png`). */
export function card_path(card: Card): string {
	return `${PREFIX}${card_key(card)}${SUFFIX}`;
}

/** The card a key names, or null when the key names none. */
export function card_of(key: string): Card | null {
	let parts: unknown;
	try {
		parts = JSON.parse(from_base64url(key));
		// oxlint-disable-next-line ogygia/no-silent-failures -- a key that is not ours names no card: the route answers 404
	} catch {
		return null;
	}
	if (!Array.isArray(parts)) return null;
	if (parts.length === 1 && parts[0] === 'home') return { home: true };
	const [kind, title, category] = parts;
	if (kind !== 'page' || typeof title !== 'string' || typeof category !== 'string') return null;
	return category ? { title, category } : { title };
}

/** The titles of the pages the worker renders on each request (not prerendered), so the og route
 *  can list their cards for the build. The pages use these same strings. */
export const SERVER_PAGE_TITLES = {
	kit: 'csr = true',
	errors: 'Errors and warnings',
	releases: 'Releases'
} as const;
