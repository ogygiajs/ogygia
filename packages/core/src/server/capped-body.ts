/**
 * A request body read up to a byte cap, whatever its headers say: a `content-length` over the cap
 * refuses it before any byte is read, and a body sent without one (chunked), or with one smaller
 * than what follows, is refused as soon as the bytes read pass the cap. Nothing past the piece
 * that passed it is read (test: test/batch-body-cap.test.ts, federation test/body-cap.test.ts).
 *
 * @returns the bytes, or null when the body is over `max`
 */
export async function read_capped(
	request: Request,
	max: number
): Promise<Uint8Array<ArrayBuffer> | null> {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > max) return null;
	if (request.body === null) return new Uint8Array(0);
	const reader = request.body.getReader();
	const pieces: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel().catch(() => {}); // ok: the rest is unwanted; a failed cancel frees nothing more
			return null;
		}
		pieces.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const p of pieces) {
		out.set(p, at);
		at += p.byteLength;
	}
	return out;
}
