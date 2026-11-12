// THE NEWEST FRAME PAINTS LAST (runtime/core.ts `#morph_live`, `#apply`). A frame waits for its
// stylesheets before it paints (no flash of unstyled content). An older frame that needs a sheet
// still on its way and a newer one that needs none must not paint in the order their sheets settle:
// the newer one paints, and the older one, its wait over, never paints over it.
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset, stamp, write } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';

/** A sheet that arrives in 300 ms; each test its own (a module loads once per page). */
const slow_sheet = (key: string) =>
	`<link rel="stylesheet" data-ogygia-region-css href="/test/browser/fixtures/slow-sheet.ts?${key}">`;
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const text = (el: Element) => el.querySelector('[data-tick]')?.textContent;

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		url?: string;
	}): Promise<void>;
};

afterEach(() => {
	document.body.innerHTML = '';
	_reset();
});

test('a static live region: an older tick waiting on its sheet does not paint over a newer one', async () => {
	const el = document.createElement('ogygia-region') as LiveRegion;
	el.setAttribute('live', '');
	document.body.append(el);
	bootDev();
	const url = '/__ogygia__?id=livepaint001&props=W3t9XQ&exp=9999999999&sig=stub';
	const live = (html: string) =>
		el.applyLive({ id: 'livepaint001', module: '', props: {}, html, url });
	await live('<p data-tick>0</p>');
	expect(text(el)).toBe('0');
	// tick 1 needs a sheet still on its way; tick 2 (through the store: a query.live tick) needs none
	void live(slow_sheet('live') + '<p data-tick>1</p>');
	const a = frameAddress(url);
	write({ a, v: stamp(), html: '<p data-tick>2</p>' });
	await expect.poll(() => text(el), { timeout: 2_000 }).toBe('2');
	await tick(600); // tick 1's sheet has come
	expect(text(el), 'the newest tick stands').toBe('2');
});

test('a hole: an older frame waiting on its sheet does not paint over a newer one', async () => {
	const endpoint = '/__ogygia__?id=holepaint001&props=W3t9XQ&exp=9999999999&sig=stub';
	const a = frameAddress(endpoint);
	// its first answer is in the store already: the hole binds and paints it, no fetch
	write({ a, v: stamp(), html: '<p data-tick>0</p>' });
	document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${endpoint}"><p>fallback</p></ogygia-region>`;
	const el = document.querySelector('ogygia-region')!;
	bootDev();
	await expect.poll(() => text(el), { timeout: 2_000 }).toBe('0');
	// two refreshes at its address: the older one links a sheet still on its way
	write({ a, v: stamp(), html: slow_sheet('hole') + '<p data-tick>1</p>' });
	write({ a, v: stamp(), html: '<p data-tick>2</p>' });
	await expect.poll(() => text(el), { timeout: 2_000 }).toBe('2');
	await tick(600);
	expect(text(el), 'the newest frame stands').toBe('2');
});
