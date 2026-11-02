// /latecomer-fixed's slow data, moved out of the page load: each deferred island asks for its own
// when it renders, so the page's first byte waits for neither.
import { query, getRequestEvent } from '$app/server';

async function get(name: string, ms: number): Promise<{ name: string; ms: number }> {
	// (the request's own origin: Kit refuses `event.url` inside a query)
	const { fetch, request } = getRequestEvent();
	const res = await fetch(`${new URL(request.url).origin}/hell/api/${name}?ms=${ms}`);
	return res.json();
}

export const getReviews = query(async () => get('reviews', 60));
export const getRecs = query(async () => get('recs-slow', 80));
