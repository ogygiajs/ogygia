import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { boot_client_plugins, type ClientRealm } from '../src/runtime/client-plugins.ts';
import { slots } from '../src/runtime/slots.ts';
import type { NavigatedEvent } from '../src/contract/runtime-hooks.ts';

const nav: NavigatedEvent = {
	from: '/',
	to: '/next',
	type: 'link',
	t: 1,
	fetched: 2,
	styled: 3,
	swapped: 4,
	reconciled: true
};
let errors: unknown[][];
beforeEach(() => {
	errors = [];
	vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a));
	slots.hooks = {};
});
afterEach(() => {
	vi.restoreAllMocks();
	slots.hooks = {};
});
const codes = () => errors.map((a) => String(a[0]));

test('three plugins on one hook run in plugin order', () => {
	const order: string[] = [];
	const realms: ClientRealm[] = ['a', 'b', 'c'].map((name) => ({
		name,
		client: { hooks: { navigated: () => void order.push(name) } }
	}));
	boot_client_plugins(realms, false);
	slots.hooks?.navigated!({ ...nav });
	expect(order).toEqual(['a', 'b', 'c']);
});

test('a throwing subscriber is reported once and never stops the ones after it', () => {
	const order: string[] = [];
	boot_client_plugins(
		[
			{ name: 'a', client: { hooks: { navigated: () => void order.push('a') } } },
			{
				name: 'b',
				client: {
					hooks: {
						navigated: () => {
							throw new Error('boom');
						}
					}
				}
			},
			{ name: 'c', client: { hooks: { navigated: () => void order.push('c') } } }
		],
		false
	);
	slots.hooks?.navigated!({ ...nav });
	slots.hooks?.navigated!({ ...nav });
	expect(order).toEqual(['a', 'c', 'a', 'c']);
	expect(codes()).toHaveLength(1);
	expect(codes()[0]).toContain('client_hook_failed');
	expect(codes()[0]).toContain('`b`');
	expect(codes()[0]).toContain('navigated');
});

test("a subscriber's rejected promise is reported, never awaited", async () => {
	const lone: ClientRealm = {
		name: 'lone',
		client: { hooks: { navigated: (async () => Promise.reject(new Error('later'))) as () => void } }
	};
	boot_client_plugins([lone], false);
	expect(slots.hooks?.navigated!({ ...nav })).toBeUndefined();
	await vi.waitFor(() => expect(codes()).toHaveLength(1));
	expect(codes()[0]).toContain('client_hook_failed');
	expect(codes()[0]).toContain('`lone`');
});

test('in dev, a subscriber that writes to the payload fails, and the next one sees it untouched', () => {
	let seen = '';
	boot_client_plugins(
		[
			{
				name: 'writer',
				client: {
					hooks: {
						navigated: (e) => {
							(e as { to: string }).to = '/elsewhere';
						}
					}
				}
			},
			{ name: 'reader', client: { hooks: { navigated: (e) => void (seen = e.to) } } }
		],
		false
	);
	slots.hooks?.navigated!({ ...nav });
	expect(seen).toBe('/next');
	expect(codes()[0]).toContain('`writer`');
});

test('a hook with no subscriber stays empty', () => {
	boot_client_plugins([{ name: 'a', client: { boot() {} } }], false);
	expect(slots.hooks?.navigated).toBeUndefined();
});
