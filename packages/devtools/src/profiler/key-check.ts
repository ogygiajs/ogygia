/**
 * The profiler's key check, on any host: Web Crypto's SHA-256 (Node, edge runtimes and workers all
 * have it) and a constant-time compare of the two digests, so how long a check takes says nothing
 * about how much of a guess was right. No `node:crypto`, so no fallback to a plain `===`.
 * test/profiler-key-web-crypto.test.ts.
 */

const encoder = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** SHA-256 of `text`, as lowercase hex. */
export async function sha256_hex(text: string): Promise<string> {
	let hex = '';
	for (const b of await sha256(text)) hex += b.toString(16).padStart(2, '0');
	return hex;
}

/** Whether `provided` is `expected`, in time that does not depend on where they differ. */
export async function same_key(provided: string, expected: string): Promise<boolean> {
	const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
