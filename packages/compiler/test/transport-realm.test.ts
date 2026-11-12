// THE APP'S TRANSPORT HOOK, BY REALM: the server realm takes core's server transport, which refuses
// ogygia values a browser sent as a remote function's argument (core's remote-arg-plain-data test);
// the browser realm takes the full transport.
import { describe, expect, it } from 'vitest';
import { kit_transport_module } from '../src/link/transport.ts';

describe("the app's transport hook, by realm", () => {
	it('the server realm takes the transport that refuses ogygia values from the browser', () => {
		expect(kit_transport_module(true, '/dist', true)).toContain('"/dist/server/transport.js"');
	});

	it('the browser realm takes the full transport', () => {
		expect(kit_transport_module(true, '/dist', false)).toContain('"/dist/transport.js"');
	});
});
