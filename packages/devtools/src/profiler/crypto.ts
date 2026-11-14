import { OgygiaError } from '../messages/runtime.ts';

const MAGIC = [0x4f, 0x47, 0x50, 0x31];
const DEV_KEY = 'ogygia-profiler-dev-key';

async function node() {
	const [crypto, zlib, util] = await Promise.all([
		import('node:crypto'),
		import('node:zlib'),
		import('node:util')
	]);
	const p = util.promisify;
	return {
		crypto,
		zlib,
		scrypt: p(crypto.scrypt) as (pw: string, salt: Uint8Array, len: number) => Promise<Buffer>,
		brotli: p(zlib.brotliCompress) as (buf: Uint8Array, opts?: unknown) => Promise<Buffer>,
		unbrotli: p(zlib.brotliDecompress) as (
			buf: Uint8Array,
			opts: { maxOutputLength: number }
		) => Promise<Buffer>
	};
}

/** The most a `.ogp` may unpack to (bytes of JSON): far past any real profile, short of a bomb. */
export const OGP_MAX_UNPACKED: number = 256 * 1_048_576;

/** True when `bytes` starts with the `.ogp` magic (so import can tell it from legacy plain JSON). */
export function is_ogp(bytes: Uint8Array): boolean {
	return (
		bytes.length > 44 &&
		bytes[0] === MAGIC[0] &&
		bytes[1] === MAGIC[1] &&
		bytes[2] === MAGIC[2] &&
		bytes[3] === MAGIC[3]
	);
}

const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

/**
 * Undo the two ways a `.ogp` gets mangled moving BETWEEN machines through a text-y channel (a shared
 * clipboard, an editor re-save, a chat) — the file arrives byte-perfect on either side of the codec,
 * so the raw magic is intact, but its wrapper isn't:
 *   - a **UTF-8 BOM** prepended (`EF BB BF`) — strip it;
 *   - the whole file **base64-encoded** — decode it.
 * A real `.ogp` already starts with the magic, so this is a no-op on it. Returns bytes to hand to
 * `is_ogp` / `ogp_decode`; if it can't recover, returns the input unchanged (import then rejects it).
 */
export function recover_ogp_bytes(bytes: Uint8Array): Uint8Array {
	if (is_ogp(bytes)) return bytes;
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		const stripped = bytes.subarray(3);
		if (is_ogp(stripped)) return stripped;
		bytes = stripped;
	}
	try {
		const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
		if (text.length > 8 && BASE64_RE.test(text)) {
			const decoded = new Uint8Array(Buffer.from(text, 'base64'));
			if (is_ogp(decoded)) return decoded;
		}
		// oxlint-disable-next-line ogygia/no-silent-failures -- not text or not base64; it is read as the bytes they are below
	} catch {}
	return bytes;
}

/**
 * A profiler dump as `.ogp` bytes: Brotli-compressed, then AES-256-GCM encrypted, so a downloaded
 * trace (source paths, component names, outbound URLs) opens only in a profiler with the same
 * `secret`. The layout is `'OGP1'`, a 16-byte salt, a 12-byte iv, the ciphertext and the 16-byte GCM
 * tag; the key is `scrypt(secret, salt, 32)`, with a fresh salt and iv per file. With no `secret`
 * (dev) a fixed dev key is used, so dev exports open in dev. The key derivation and Brotli run off
 * the event loop.
 */
export async function ogp_encode(dump: unknown, secret: string | undefined): Promise<Uint8Array> {
	const { crypto, zlib, scrypt, brotli } = await node();
	const gz = await brotli(Buffer.from(JSON.stringify(dump), 'utf8'), {
		params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 }
	});
	const salt = crypto.randomBytes(16);
	const iv = crypto.randomBytes(12);
	const key = await scrypt(secret || DEV_KEY, salt, 32);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const ct = Buffer.concat([cipher.update(gz), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([Buffer.from(MAGIC), salt, iv, ct, tag]);
}

/**
 * Decrypt + decompress `.ogp` bytes back to the dump object. Throws on a wrong key or a tampered file
 * (the GCM tag fails to verify) — the caller turns that into a "wrong key" message. Unpacking stops
 * at `max` bytes: past it, `devtools_profiler_upload_too_large`.
 */
export async function ogp_decode(
	bytes: Uint8Array,
	secret: string | undefined,
	max: number = OGP_MAX_UNPACKED
): Promise<unknown> {
	const { crypto, scrypt, unbrotli } = await node();
	const buf = Buffer.from(bytes);
	if (!is_ogp(buf)) throw new Error('not an .ogp file');
	const salt = buf.subarray(4, 20);
	const iv = buf.subarray(20, 32);
	const tag = buf.subarray(buf.length - 16);
	const ct = buf.subarray(32, buf.length - 16);
	const key = await scrypt(secret || DEV_KEY, salt, 32);
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	const gz = Buffer.concat([decipher.update(ct), decipher.final()]);
	let json: Buffer;
	try {
		json = await unbrotli(gz, { maxOutputLength: max });
	} catch (e) {
		if ((e as { code?: unknown })?.code !== 'ERR_BUFFER_TOO_LARGE') throw e;
		throw new OgygiaError('devtools_profiler_upload_too_large', { limit: max });
	}
	return JSON.parse(json.toString('utf8'));
}
