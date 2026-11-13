// A REQUEST BODY READ UNDER A CAP (server/capped-body.ts). It never throws: no body is no bytes, a
// body past the cap is 'too large' (its source let go, even one whose cancel fails), and a body
// whose stream breaks is 'unreadable'.
import { expect, it } from 'vitest';
import { read_capped } from '../src/server/capped-body.ts';

const post = (body: ReadableStream<Uint8Array> | null) =>
	new Request('https://app.test/x', { method: 'POST', body, duplex: 'half' } as RequestInit);

it('a request with no body is no bytes', async () => {
	const got = await read_capped(new Request('https://app.test/x'), 10);
	expect(got).toBeInstanceOf(Uint8Array);
	expect((got as Uint8Array).byteLength).toBe(0);
});

it('a body past the cap is too large, even when its source cannot be cancelled', async () => {
	const body = new ReadableStream<Uint8Array>({
		start(c) {
			c.enqueue(new Uint8Array(20));
		},
		cancel() {
			throw new Error('a source that cannot be cancelled');
		}
	});
	await expect(read_capped(post(body), 10)).resolves.toBe('too large');
});

it('a body whose stream breaks is unreadable, never a throw', async () => {
	const body = new ReadableStream<Uint8Array>({
		start(c) {
			c.enqueue(new Uint8Array(2));
			setTimeout(() => c.error(new Error('the connection dropped')), 5);
		}
	});
	await expect(read_capped(post(body), 10)).resolves.toBe('unreadable');
});
