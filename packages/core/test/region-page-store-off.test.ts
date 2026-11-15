import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import RegionUnder from './_fixtures/RegionUnder.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import { page } from './_stubs/app-state.ts';
import { csr_true_routes, error_csr_true_routes } from './_stubs/server.route-csr.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import type { RegionSettings } from '../src/region-plan.ts';

type Props = Record<string, unknown>;
const under = RegionUnder as unknown as Component<{ regions: Props[] }>;
const ROUTE = '/plain';
const ISLAND: RegionSettings = {
	mode: 'island',
	entry: '/islands/tiny.js',
	component: Tiny as never
};

afterEach(() => {
	Object.defineProperty(page, 'error', { value: null, writable: true, configurable: true });
	error_csr_true_routes.clear();
	csr_true_routes.clear();
	set_request_event_stub(null);
});

function body_with_no_page_store(): string {
	Object.defineProperty(page, 'error', {
		configurable: true,
		get() {
			throw new Error('no page store in this render');
		}
	});
	set_request_event_stub(() => ({ route: { id: ROUTE } }));
	return render(under, { props: { regions: [{ __og: ISLAND, __props: { n: 1 } }] } }).body;
}

describe('a region rendered where Kit has no page store (a hole endpoint, a remote region)', () => {
	it('renders, reading no page error and asking the page seed for nothing', () => {
		expect(() => body_with_no_page_store()).not.toThrow();
	});

	it("plans from its route's csr, not its error page's: on a csr=false route it is an island shell", () => {
		error_csr_true_routes.add(ROUTE);
		expect(body_with_no_page_store()).toContain('<ogygia-region entry="/islands/tiny.js"');
	});

	it('on a csr=true route it renders inline, for Kit to hydrate', () => {
		csr_true_routes.add(ROUTE);
		expect(body_with_no_page_store()).not.toContain('<ogygia-region');
	});
});
