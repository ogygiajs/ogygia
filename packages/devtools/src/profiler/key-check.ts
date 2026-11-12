/**
 * The profiler's key, session and flag checks, on any host: Web Crypto (Node, edge runtimes and
 * workers all have it) for the hashes, the derived keys and the MACs, and constant-time compares,
 * so how long a check takes says nothing about how much of a guess was right. No `node:crypto`, so
 * no fallback to a plain `===` and no host where sessions stop working.
 * test/profiler-key-web-crypto.test.ts.
 */

const encoder = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

function hex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

/** SHA-256 of `text`, as lowercase hex. */
export async function sha256_hex(text: string): Promise<string> {
	return hex(await sha256(text));
}

/** Whether `provided` is `expected`, in time that does not depend on where they differ. */
export async function same_key(provided: string, expected: string): Promise<boolean> {
	const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}

/** Whether two strings are equal, in time that depends only on their lengths (a MAC against the
 *  one it should be: both of one fixed length). */
export function same_text(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** An HMAC-SHA256 key derived from `secret` for one use (`info`): HKDF-SHA256 with an empty salt,
 *  the same 32 bytes as `node:crypto`'s `hkdfSync('sha256', secret, '', info, 32)`. */
export async function mac_key(secret: string, info: string): Promise<CryptoKey> {
	const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
		'deriveKey'
	]);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) },
		base,
		{ name: 'HMAC', hash: 'SHA-256', length: 256 },
		false,
		['sign']
	);
}

/** HMAC-SHA256 of `message` under `key`, as lowercase hex. */
export async function mac_hex(key: CryptoKey, message: string): Promise<string> {
	return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

/** `bytes` random bytes, base64url without padding. */
export function random_id(bytes: number): string {
	const raw = crypto.getRandomValues(new Uint8Array(bytes));
	let bin = '';
	for (const b of raw) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
