const PLUS_G = /\+/g;
const SLASH_G = /\//g;
const TRAILING_EQUALS_RE = /=+$/;
const DASH_G = /-/g;
const UNDERSCORE_G = /_/g;
const IOS_UA_RE = /iP(hone|ad|od)/;
const SAFARI_UA_RE = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i;

const MAGIC = new Uint8Array([0x4f, 0x47, 0x4c, 0x31]);
const PBKDF2_ITERS = 210_000;
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;
const part = (u: Uint8Array): BlobPart => u as unknown as BlobPart;

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const cs = new CompressionStream('gzip');
	const blob = await new Response(new Blob([part(bytes)]).stream().pipeThrough(cs)).arrayBuffer();
	return new Uint8Array(blob);
}
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream('gzip');
	const blob = await new Response(new Blob([part(bytes)]).stream().pipeThrough(ds)).arrayBuffer();
	return new Uint8Array(blob);
}

async function derive_key(password: string, salt: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
	const base = await subtle().importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey']
	);
	return subtle().deriveKey(
		{ name: 'PBKDF2', salt: buf(salt), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		[usage]
	);
}

function b64url_encode(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s).replace(PLUS_G, '-').replace(SLASH_G, '_').replace(TRAILING_EQUALS_RE, '');
}
function b64url_decode(str: string): Uint8Array {
	const s = str.replace(DASH_G, '+').replace(UNDERSCORE_G, '/');
	const bin = atob(s + '==='.slice((s.length + 3) % 4));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Encrypts a report dump into a share link's `#fragment` (`…/view#<blob>`), so a report can be shared
 * as a URL instead of an `.ogp` file. Browsers never send the fragment to a server: the report lives
 * in the link alone (no storage), and no server sees the report or the password. Links are permanent,
 * so the format never changes.
 *
 * It runs in browsers (the sharer encodes, the recipient decodes), so it uses what they all have:
 * gzip (`CompressionStream`, no Brotli in JS), then AES-256-GCM with a PBKDF2-SHA256 key at 210 000
 * rounds (the OWASP 2023 floor; the Node `.ogp` path uses scrypt, which `crypto.subtle` lacks), then
 * base64url without padding (no `+`, `/` or `=`). Layout before base64url: `OGL1` (4 bytes), salt (16),
 * iv (12), ciphertext and tag.
 */
export async function encode_permalink(dump: unknown, password: string): Promise<string> {
	const plain = await gzip(new TextEncoder().encode(JSON.stringify(dump)));
	const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const key = await derive_key(password, salt, 'encrypt');
	const ct = new Uint8Array(
		await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(plain))
	);
	const out = new Uint8Array(MAGIC.length + salt.length + iv.length + ct.length);
	out.set(MAGIC, 0);
	out.set(salt, MAGIC.length);
	out.set(iv, MAGIC.length + salt.length);
	out.set(ct, MAGIC.length + salt.length + iv.length);
	return b64url_encode(out);
}

/** Reverse of {@link encode_permalink}. Throws on a wrong password / tampered blob (GCM tag fails). */
export async function decode_permalink(blob: string, password: string): Promise<unknown> {
	const bytes = b64url_decode(blob);
	if (
		bytes.length < 4 ||
		bytes[0] !== 0x4f ||
		bytes[1] !== 0x47 ||
		bytes[2] !== 0x4c ||
		bytes[3] !== 0x31
	)
		throw new Error('not an ogygia share link');
	const salt = bytes.subarray(4, 20);
	const iv = bytes.subarray(20, 32);
	const ct = bytes.subarray(32);
	const key = await derive_key(password, salt, 'decrypt');
	const plain = new Uint8Array(
		await subtle().decrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(ct))
	);
	return JSON.parse(new TextDecoder().decode(await gunzip(plain)));
}

/** All-WebKit browsers (desktop Safari + EVERY iOS browser) hard-error past ~80 K URL chars, too small
 *  for a real report — so universal links are disabled there. Chromium (~2 MB) and Firefox handle it. */
export function is_webkit_capped(): boolean {
	const ua = navigator.userAgent;
	const ios = IOS_UA_RE.test(ua);
	const safari = SAFARI_UA_RE.test(ua);
	return ios || safari;
}

/** Chromium tops out at a 2 MB URL; keep a safe margin. Fragment chars ≈ blob length (all ASCII). */
export const MAX_PERMALINK_CHARS = 1_500_000;
