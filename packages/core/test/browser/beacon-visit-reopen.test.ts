// THE VISIT AFTER A TAB SWITCH (devtools profiler/beacon.ts, #209), in a real browser: hiding the page sends
// the visit, but the visit is not over. Coming back to the tab, or a back/forward cache restore,
// opens it again: what happens after (a navigation, a worse interaction, a shift) goes out with
// the next hide.
import { afterEach, beforeEach, expect, inject, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset_beacon, beacon_nav } from '../../../devtools/src/profiler/beacon.ts';
import devtools_client from '../../../devtools/src/client.ts';

const inject_html = () => decodeURIComponent(escape(atob(inject('counter_json_lane_ssr_b64'))));

type Body = { page: string; visit?: { navs?: { to: string }[] }; vitals?: object };
let sent: Body[] = [];
let meta: HTMLMetaElement;
const orig_beacon = navigator.sendBeacon;

/** the tab's visibility as the browser reports it, with its event */
function set_visibility(state: 'hidden' | 'visible'): void {
	Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
	document.dispatchEvent(new Event('visibilitychange'));
}

const nav = (to: string) =>
	beacon_nav({ from: '/', to, type: 'link', t: 1, fetched: 2, styled: 3, swapped: 4 });
const visits = () => sent.filter((b) => b.visit);

beforeEach(async () => {
	await Promise.all([
		import('/test/browser/fixtures/Counter.svelte'),
		import('../../src/runtime/hydrate-core.ts')
	]);
	_reset_beacon();
	meta = document.createElement('meta');
	meta.name = 'ogygia-profiler-beacon';
	meta.content = '/__profiler/beacon';
	document.head.appendChild(meta);
	sent = [];
	navigator.sendBeacon = ((_url: string, body: string) => {
		sent.push(JSON.parse(body) as Body);
		return true;
	}) as typeof navigator.sendBeacon;
	document.body.innerHTML = inject_html();
	bootDev([{ name: '@ogygia/devtools', client: devtools_client }]);
	await expect
		.poll(() => document.querySelector('ogygia-region[data-og-fp][data-hydrated]') !== null, {
			timeout: 20_000
		})
		.toBe(true);
});

afterEach(() => {
	navigator.sendBeacon = orig_beacon;
	delete (document as { visibilityState?: string }).visibilityState;
	meta.remove();
});

test('a navigation after coming back to the tab goes out with the next hide', async () => {
	set_visibility('hidden');
	expect(visits().length).toBeGreaterThan(0);
	set_visibility('visible');
	nav('/after-the-tab-switch');
	const before = visits().length;
	set_visibility('hidden');
	const after = visits().slice(before);
	expect(after.length).toBeGreaterThan(0);
	expect(after[after.length - 1].visit!.navs?.map((n) => n.to)).toContain('/after-the-tab-switch');
});

test('a page restored from the back/forward cache reports again', async () => {
	dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
	expect(visits().length).toBeGreaterThan(0);
	dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
	nav('/after-the-restore');
	const before = visits().length;
	dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
	const after = visits().slice(before);
	expect(after.length).toBeGreaterThan(0);
	expect(after[after.length - 1].visit!.navs?.map((n) => n.to)).toContain('/after-the-restore');
});

test('a second hide with no return in between sends nothing more', async () => {
	set_visibility('hidden');
	const before = sent.length;
	dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
	expect(sent.length).toBe(before);
});
