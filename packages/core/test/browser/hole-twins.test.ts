// TWO COPIES OF ONE HOLE (a header's account link in the desktop bar and again in the mobile
// drawer): the same call, so the same frame-store address, and one shared fetch. A copy that leaves
// the page (a navigation, an `{#if}`) gives up only ITS stake in that fetch: its twin's fetch, a
// retry or a batch it joined, is not cancelled or left hanging by it.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import { done_parcel } from '../../src/server/stream-regions.ts';

const real_fetch = window.fetch;
beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => {
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

const hole = (endpoint: string, label: string) =>
	`<ogygia-region render="defer" when="load" endpoint="${endpoint}"><p data-fallback>${label}</p></ogygia-region>`;

function insert(html: string): HTMLElement[] {
	const box = document.createElement('div');
	box.innerHTML = html;
	const regions = Array.from(box.querySelectorAll<HTMLElement>('ogygia-region'));
	document.body.append(...Array.from(box.childNodes));
	return regions;
}

/** A fetch that answers when told, and rejects as the browser does once its signal aborts. */
function held(init?: RequestInit) {
	let answer!: (res: Response) => void;
	let aborted = false;
	const promise = new Promise<Response>((resolve, reject) => {
		answer = resolve;
		init?.signal?.addEventListener('abort', () => {
			aborted = true;
			reject(new DOMException('The user aborted a request.', 'AbortError'));
		});
	});
	return {
		promise,
		answer: (res: Response) => answer(res),
		get aborted() {
			return aborted;
		}
	};
}

const html = (body: string) =>
	new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

test('a copy that leaves does not cancel its twin’s retry', async () => {
	const ENDPOINT = '/__ogygia__?id=twin00000001&props=W3t9XQ&exp=9999999999&sig=stub';
	let calls = 0;
	let retry: ReturnType<typeof held> | null = null;
	window.fetch = async (_input, init) => {
		const n = ++calls;
		if (n === 1) return new Response('', { status: 500 }); // the first copy's fetch fails: it retries
		if (n === 2) return new Response('', { status: 403 }); // the second copy is refused (final)
		retry = held(init);
		return retry.promise;
	};
	const [first] = insert(hole(ENDPOINT, 'first'));
	bootDev();
	await expect.poll(() => calls, { timeout: 5_000 }).toBe(1);
	// while the first copy waits to retry, the second one fetches the same call, alone, and is refused
	const [second] = insert(hole(ENDPOINT, 'second'));
	await expect.poll(() => calls, { timeout: 5_000 }).toBe(2);
	// the first copy's retry goes out, and the second copy leaves the page meanwhile
	await expect.poll(() => retry !== null, { timeout: 5_000 }).toBe(true);
	second.remove();
	await new Promise((r) => setTimeout(r, 50));
	expect(retry!.aborted, 'the leaving copy did not cancel its twin’s fetch').toBe(false);
	retry!.answer(html('<p data-testid="served">served</p>'));
	await expect
		.poll(() => first.querySelector('[data-testid="served"]') !== null, { timeout: 5_000 })
		.toBe(true);
});

test('a copy that leaves does not leave its twin waiting on a batch it joined', async () => {
	const X = '/__ogygia__?id=twin00000002&props=W3t9XQ&exp=9999999999&sig=sx';
	const Y = '/__ogygia__?id=twin00000003&props=W3t9XQ&exp=9999999999&sig=sy';
	const gets: string[] = [];
	let batch: ReturnType<typeof held> | null = null;
	window.fetch = async (input, init) => {
		if (init?.method === 'POST') {
			batch = held(init);
			return batch.promise;
		}
		gets.push(String(input));
		// the first copy's own fetch is refused; any later one is answered
		if (gets.length === 1) return new Response('', { status: 403 });
		return html('<p data-testid="served">served</p>');
	};
	const [leaving] = insert(hole(X, 'leaving'));
	bootDev();
	await expect.poll(() => gets.length, { timeout: 5_000 }).toBe(1);
	// two holes start together: one batch for both, and the twin joins it
	const [twin] = insert(hole(X, 'twin') + hole(Y, 'other'));
	await expect.poll(() => batch !== null, { timeout: 5_000 }).toBe(true);
	await new Promise((r) => setTimeout(r, 50)); // (both holes have joined the batch's reservations)
	leaving.remove();
	await new Promise((r) => setTimeout(r, 50));
	// the batch ends without either part: each hole should fetch on its own
	batch!.answer(html(done_parcel()));
	await expect
		.poll(() => gets.filter((g) => g.includes('twin00000002')).length, {
			timeout: 5_000,
			message: 'the twin fetched on its own once the batch ended without its part'
		})
		.toBe(2);
	await expect
		.poll(() => twin.querySelector('[data-testid="served"]') !== null, { timeout: 5_000 })
		.toBe(true);
});
