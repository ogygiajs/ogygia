// A held region's query that fails (#915): the page sees the query's own error, never a TypeError
// from inside Svelte. In Svelte 5.56.8, once one held region's query had failed, the next one that
// failed as its region left walked up the effect tree into a destroyed boundary and threw
// `Cannot read properties of null (reading 'error')`.
import { expect, test } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import HeldQueryHost from './fixtures/HeldQueryHost.svelte';

/** Mount a held region whose query fails; `leave`: the region leaves the page first. */
async function query_fails(leave: boolean): Promise<void> {
	const target = document.body.appendChild(document.createElement('div'));
	const query = Promise.withResolvers<never>();
	const app = mount(HeldQueryHost, { target, props: { query: () => query.promise } }) as {
		hide: () => void;
	};
	await tick();
	if (leave) {
		app.hide();
		await new Promise((r) => setTimeout(r, 20));
	}
	query.reject(new Error('Failed to fetch'));
	await new Promise((r) => setTimeout(r, 100));
	await unmount(app);
	target.remove();
}

test('a held region whose query fails after another one failed: no TypeError reaches the page', async () => {
	const reached: unknown[] = [];
	const on_error = (e: ErrorEvent) => (reached.push(e.error), e.preventDefault());
	const on_rejection = (e: PromiseRejectionEvent) => (reached.push(e.reason), e.preventDefault());
	window.addEventListener('error', on_error);
	window.addEventListener('unhandledrejection', on_rejection);
	try {
		await query_fails(false);
		await query_fails(true);
	} finally {
		window.removeEventListener('error', on_error);
		window.removeEventListener('unhandledrejection', on_rejection);
	}
	expect(reached.filter((e) => e instanceof TypeError).map(String)).toEqual([]);
});
