import { afterEach, expect, test } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import Region from '../src/Region.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import { set_server_devtools_recorder } from '../src/events/server-registry.ts';

afterEach(() => set_server_devtools_recorder(null));

test('with devtools off, a region records no server event', () => {
	expect((globalThis as { __OGYGIA_DEVTOOLS__?: boolean }).__OGYGIA_DEVTOOLS__).toBeUndefined();
	const events: unknown[] = [];
	set_server_devtools_recorder((e) => events.push(e));
	const out = render(Region as unknown as Component<Record<string, unknown>>, {
		props: { __mode: 'island', __entry: '/islands/tiny.js', __component: Tiny, __props: {} }
	});
	expect(out.body).toContain('<ogygia-region');
	expect(events).toEqual([]);
});
