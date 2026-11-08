// OUTBOUND NETWORK CAPTURE (profiler/net.ts): the patched fetch hands each call to the profiler
// whose request made it. Real AsyncLocalStorage contexts, a real fetch patch over a stand-in fetch.
import { AsyncLocalStorage } from 'node:async_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { install_net_capture, type NetCall, type NetContext } from '../src/profiler/net.ts';

const real_fetch = globalThis.fetch;
beforeAll(() => {
	globalThis.fetch = (async () => new Response('ok')) as typeof fetch;
});
afterAll(() => {
	globalThis.fetch = real_fetch;
});

const context = (seen: string[]): NetContext => ({
	route: '/r',
	path: '/p',
	on_net: (call: NetCall) => void seen.push(call.url)
});

describe('install_net_capture', () => {
	it('after the hooks run again, a call in the new profiler’s request reaches the new profiler (#285)', async () => {
		const first = new AsyncLocalStorage<NetContext>();
		const first_left: string[] = [];
		await install_net_capture(first, (call) => void first_left.push(call.url));
		// the hooks module runs again (a dev edit): a new profiler, with a storage of its own
		const second = new AsyncLocalStorage<NetContext>();
		const second_left: string[] = [];
		await install_net_capture(second, (call) => void second_left.push(call.url));

		const seen: string[] = [];
		await second.run(context(seen), () => fetch('http://upstream.test/a'));
		expect(seen).toEqual(['http://upstream.test/a']);
		expect(first_left).toEqual([]);
		// a call outside any request lands in the live profiler's fallback
		await fetch('http://upstream.test/b');
		expect(second_left).toEqual(['http://upstream.test/b']);
		expect(first_left).toEqual([]);
	});
});
