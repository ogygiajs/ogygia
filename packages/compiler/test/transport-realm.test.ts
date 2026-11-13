// THE APP'S TRANSPORT HOOK, BY REALM: the server realm takes core's server transport, which refuses
// ogygia values a browser sent as a remote function's argument (core's remote-arg-plain-data test);
// the browser realm takes the full transport.
import { describe, expect, it } from 'vitest';
import {
	kit_transport_module,
	transportables_client_module
} from '../src/compiler/link/transport.ts';

describe('the browser leg of the wired classes', () => {
	it('loads every class before any island wakes only when the app sends wired values through Kit', () => {
		const rel = (abs: string) => abs.slice(1);
		expect(transportables_client_module(['/a/Money.ts'], rel, true)).toContain(
			'export const wire_all = true;'
		);
		expect(transportables_client_module(['/a/Money.ts'], rel, false)).toContain(
			'export const wire_all = false;'
		);
		expect(transportables_client_module([], rel, true)).toContain('export const wire_all = false;');
	});
});

describe("the app's transport hook, by realm", () => {
	it('the server realm takes the transport that refuses ogygia values from the browser', () => {
		expect(kit_transport_module(true, '/dist', true)).toContain('"/dist/server/transport.js"');
	});

	it('the browser realm takes the full transport', () => {
		expect(kit_transport_module(true, '/dist', false)).toContain('"/dist/transport.js"');
	});
});
