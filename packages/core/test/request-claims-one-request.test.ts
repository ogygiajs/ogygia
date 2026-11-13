// ONE REQUEST, MANY EVENT OBJECTS. Kit hands the code of one request several event objects: the
// handle's (a traced copy), the page render's (another copy), each load's, and a remote function's
// called during the render (`derive_remote_function_event`: a new object). They all carry the one
// `Request`. A held region awaited in a load or rendered by a remote call is spliced into the same
// document as the page's own regions, so what the DOCUMENT counts (its slot ids, the live copies a
// navigation may skip) is the request's, whatever event object the code runs under.
import { afterEach, describe, expect, it } from 'vitest';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import { next_slot_id } from '../src/region-snippet.ts';
import { set_kit_event_reader } from '../src/server/kit-context.ts';

const { reuse_known_region } = await import('../src/server/region-endpoint.ts');

const flag = globalThis as { __OGYGIA_SERVER_DELTA__?: boolean };

/** Two event objects of one request, as Kit makes them (a page render's, and a load's or a remote
 *  call's: the same fields, copied). */
function one_request(headers: Record<string, string> = {}) {
	const request = new Request('https://app.test/products/', { headers });
	const page = {
		request,
		url: new URL(request.url),
		route: { id: '/products' }
	};
	const other = { ...page, tracing: {} };
	return { page, other };
}

/** Run `fn` as code under `event` (both readers the library has see it). */
function under<T>(event: object, fn: () => T): T {
	set_request_event_stub(() => event);
	set_kit_event_reader(() => event);
	try {
		return fn();
	} finally {
		set_request_event_stub(null);
		set_kit_event_reader(null);
	}
}

afterEach(() => {
	set_request_event_stub(null);
	set_kit_event_reader(null);
	delete flag.__OGYGIA_SERVER_DELTA__;
});

describe('what one document counts is counted once, under any event object of its request', () => {
	it('a held region rendered by a load never mints a slot id the page also mints', () => {
		const { page, other } = one_request();
		const held = under(other, () => [
			next_slot_id('/entry/Card.js'),
			next_slot_id('/entry/Card.js')
		]);
		const own = under(page, () => [next_slot_id('/entry/Card.js'), next_slot_id('/entry/Card.js')]);
		expect(own.filter((id) => held.includes(id))).toEqual([]);
	});

	it('a navigation skips no more copies of a region than the browser has live', () => {
		flag.__OGYGIA_SERVER_DELTA__ = true;
		const { page, other } = one_request({
			'x-ogygia-spa': '1',
			'x-ogygia-known': 'f00dfeed'
		});
		expect(under(other, () => reuse_known_region('f00dfeed'))).toBe(true);
		expect(under(page, () => reuse_known_region('f00dfeed'))).toBe(false);
	});
});
