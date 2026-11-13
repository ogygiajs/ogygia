/** Redirect statuses a fetch follows. */
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * A server's own `fetch` over the simulated network, as Node's does: it follows a redirect (each
 * leg a request of its own through `send`; `redirect: 'manual'` hands the redirect back, `'error'`
 * fails it), and its answer carries the URL it came from and whether a redirect led there. A
 * federation peer is trusted by that URL (a peer document's runtime counts only from the peer's own
 * origin): an answer with no URL lost every mounted peer page's runtime (gen 7; test/redirect.test.ts).
 */
export async function server_fetch(
	request: Request,
	send: (request: Request) => Promise<Response>
): Promise<Response> {
	const body =
		request.method === 'GET' || request.method === 'HEAD' || request.body === null
			? undefined
			: await request.arrayBuffer();
	let url = new URL(request.url);
	let method = request.method;
	let carried = body;
	for (let hops = 0; ; hops++) {
		const leg = new Request(url, {
			method,
			headers: request.headers,
			body: carried,
			redirect: 'manual',
			signal: request.signal
		});
		const answer = await send(leg);
		const location = answer.headers.get('location');
		if (REDIRECTS.has(answer.status) && location !== null && request.redirect !== 'manual') {
			void answer.body?.cancel();
			if (request.redirect === 'error' || hops === 20) throw new TypeError('fetch failed');
			url = new URL(location, url);
			if (answer.status === 303 || (answer.status < 303 && method === 'POST')) {
				method = method === 'HEAD' ? 'HEAD' : 'GET';
				carried = undefined;
			}
			continue;
		}
		Object.defineProperties(answer, {
			url: { value: url.href, configurable: true },
			redirected: { value: hops > 0, configurable: true }
		});
		return answer;
	}
}
