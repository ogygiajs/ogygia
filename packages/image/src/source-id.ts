/**
 * A source's id: a hash of its bytes, which names every file made from it. Whoever makes a file (the
 * endpoint's reader, the build's writer) checks the original it read against it. Web Crypto only, so
 * a Worker with no Node APIs can check too.
 *
 * @packageDocumentation
 */

/** Bump when the encoder's output changes for the same input: every cached file is made again, and
 *  every source gets a new id, so every file a new name. test/encode-settings.test.ts holds what
 *  each version asks sharp for. */
export const ENCODER_VERSION = 5;

const ID_LENGTH = 16;

/** A source's id: its bytes (and the encoder's version), so every file made from it names its
 *  content. Whoever makes a file checks the original it read against the id it is named by. */
export async function source_id(bytes: Uint8Array): Promise<string> {
	const tail = new TextEncoder().encode(`\0encoder ${ENCODER_VERSION}`);
	const all = new Uint8Array(bytes.byteLength + tail.byteLength);
	all.set(bytes);
	all.set(tail, bytes.byteLength);
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
	let bin = '';
	for (const b of hash.subarray(0, 12)) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').slice(0, ID_LENGTH);
}
