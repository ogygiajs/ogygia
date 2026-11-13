/**
 * A PAGE'S FACTS FROM A DATA ANSWER THAT BROKE (server/page-facts.ts, #1626). A hole rendering for
 * a page reads that page's facts from Kit's data request; every way that request fails is a reason
 * (`miss`), and the render goes on without them. A body that broke before its first line is one
 * more: once it rejected the look-up, and the hole's render failed as if its own code threw.
 */
import { expect, it } from 'vitest';
import { look_up_page } from '../src/server/page-facts.ts';

it('a data answer that breaks before its first line is a miss that says why, never a throw', async () => {
	const body = new ReadableStream<Uint8Array>({
		start(c) {
			c.enqueue(new TextEncoder().encode('{"type":"da'));
			setTimeout(() => c.error(new Error('the answer broke')), 5);
		}
	});
	const facts = await look_up_page(
		new URL('https://a.test/x'),
		async () => new Response(body),
		{}
	).catch((e: unknown) => ({ threw: String(e) }));
	expect(facts).toEqual({ miss: 'the data answer broke (the answer broke)' });
});
