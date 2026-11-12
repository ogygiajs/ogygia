// What `LakeBoundary.svelte` states about a lake's inside, against the source (#512).
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { set_request_event_stub } from './_stubs/virtual-request-event.ts';
import AwakeLakeHost from './_fixtures/AwakeLakeHost.svelte';

const OUTER_RE = /<ogygia-region entry="\/islands\/outer\.js" wake="load"/;
const INNER_RE = /<ogygia-region entry="\/islands\/tiny\.js" wake="load"/;

afterEach(() => set_request_event_stub(null));

describe('LakeBoundary claims', () => {
	it('a waking island inside a lake inside an awake island emits its own region (csr=false)', () => {
		set_request_event_stub(() => ({ route: { id: '/plain' } }));
		const { body } = render(AwakeLakeHost as unknown as Component);
		expect(body).toMatch(OUTER_RE);
		expect(body).toContain('<p data-inner="">frozen inside</p>');
		const inner = body.match(INNER_RE);
		expect(inner, body).not.toBeNull();
		expect(body.indexOf(inner![0])).toBeGreaterThan(body.search(OUTER_RE));
		expect(body).toContain('<b data-tiny="">tiny</b>');
	});
});
