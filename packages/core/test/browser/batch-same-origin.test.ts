// A BATCH OF HOLES GOES ONLY TO THIS ORIGIN, AND TAKES ONLY THIS ORIGIN'S ANSWER (HOLE-TRUST,
// internal/notes/INVARIANTS.md; runtime/frame-nav.ts `streamFrames`). A hole fetched on its own is
// refused when its endpoint or its answer is another origin's; the batch that carries many holes at
// once holds the same line: no request to another origin, and no part of an answer that ended on one
// is written into the frame store.
import { afterEach, expect, test, vi } from 'vitest';
import { streamFrames } from '../../src/runtime/frame-nav.ts';
import { _reset, peek } from '../../src/runtime/frame-store.ts';
import { frameAddress } from '../../src/frame.ts';
import { build_parcel } from '../../src/server/stream-regions.ts';

const ep = (base: string, sig: string) =>
	`${base}/__ogygia__?id=bbbbbbbbbbbb&props=${sig}&exp=9999999999&sig=${sig}`;

/** A batch answer carrying `parcels`, as if the browser got it at `url`. */
function answer(parcels: string, url: string): Response {
	const res = new Response(parcels + build_parcel('__ogygia_done__', ''), {
		status: 200,
		headers: { 'content-type': 'text/html' }
	});
	Object.defineProperty(res, 'url', { value: url });
	Object.defineProperty(res, 'redirected', {
		value: url !== new URL('/__ogygia__', location.href).href
	});
	return res;
}

afterEach(() => {
	vi.restoreAllMocks();
	_reset();
});

test('a batch whose endpoint is another origin sends no request', async () => {
	const fetch = vi
		.spyOn(window, 'fetch')
		.mockImplementation(async () =>
			answer(build_parcel('f1', '<p>foreign</p>'), 'https://other.example/__ogygia__')
		);
	const call = ep('https://other.example', 'f1');
	await streamFrames([call], 'page');
	expect(fetch).not.toHaveBeenCalled();
	expect(peek(frameAddress(call))).toBeNull();
});

test('a batch whose answer ended on another origin writes none of its parts', async () => {
	vi.spyOn(window, 'fetch').mockImplementation(async () =>
		answer(build_parcel('r1', '<p>foreign</p>'), 'https://other.example/landing')
	);
	const call = ep('', 'r1');
	await streamFrames([call], 'page');
	expect(peek(frameAddress(call))).toBeNull();
});

test('a batch answered by this origin writes its parts', async () => {
	vi.spyOn(window, 'fetch').mockImplementation(async () =>
		answer(build_parcel('s1', '<p>own</p>'), new URL('/__ogygia__', location.href).href)
	);
	const call = ep('', 's1');
	await streamFrames([call], 'page');
	expect(peek(frameAddress(call))?.html).toBe('<p>own</p>');
});
