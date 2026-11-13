/** Why a request body was not read: past the cap (413), or its stream failed (a client that
 *  aborted or reset mid-upload: 400). */
export type BodyRefused = 'too large' | 'unreadable';

/**
 * A request body read up to a byte cap, whatever its headers say: a `content-length` over the cap
 * refuses it before any byte is read, and a body sent without one (chunked), or with one smaller
 * than what follows, is refused as soon as the bytes read pass the cap. Nothing past the piece
 * that passed it is read (test: test/batch-body-cap.test.ts, federation test/body-cap.test.ts).
 * It never throws: a body whose stream fails is `'unreadable'` (devtools
 * test/profiler-body-cap.test.ts, federation test/body-unreadable.test.ts).
 *
 * @returns the bytes, or why there are none
 */
export async function read_capped(
	request: Request,
	max: number
): Promise<Uint8Array<ArrayBuffer> | BodyRefused> {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > max) return 'too large';
	if (request.body === null) return new Uint8Array(0);
	const pieces: Uint8Array[] = [];
	let size = 0;
	try {
		const reader = request.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > max) {
				await reader.cancel().catch(() => {}); // ok: the rest is unwanted; a failed cancel frees nothing more
				return 'too large';
			}
			pieces.push(value);
		}
	} catch {
		return 'unreadable'; // ok: the caller answers it (a 400)
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const p of pieces) {
		out.set(p, at);
		at += p.byteLength;
	}
	return out;
}
