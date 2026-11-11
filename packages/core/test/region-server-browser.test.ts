// The browser's stand-ins for the server's half of a region's render (src/region-server.browser.ts):
// every reader answers "none", and the request event refuses with its message code.
import { describe, expect, it } from 'vitest';
import * as browser from '../src/region-server.browser.ts';

describe('#region-server in the browser', () => {
	it('answers none to every reader', () => {
		expect(browser.region_deps('a')).toEqual([]);
		expect(browser.region_css('a')).toEqual([]);
		expect(browser.content_css('a')).toEqual([]);
		expect(browser.hole_css('a')).toEqual([]);
		expect(browser.region_css_inline('a')).toBeNull();
		expect(browser.region_page_keys('a')).toBeNull();
		expect(browser.region_remotes('a')).toBeNull();
		expect(browser.region_interactivity('a')).toBeNull();
		expect(browser.entry_location('a')).toBeNull();
		expect(browser.region_reads_page('a')).toBe(false);
		expect(browser.known_region_fps().size).toBe(0);
		expect(browser.make_region_endpoint('a')).toBe('');
		expect(browser.region_fingerprint('a')).toBe('');
		expect(browser.runtime_bootstrap()).toBe('');
		expect(browser.region_css_tag('/a.css', '/a.css')).toBe('');
		expect(browser.csr_true_routes.size).toBe(0);
		expect(browser.root_layout_csr_true).toBe(true);
	});

	it('refuses getRequestEvent with request_event_server_only', () => {
		expect(() => browser.get_request_event()).toThrow(/e\/request_event_server_only/);
	});
});
