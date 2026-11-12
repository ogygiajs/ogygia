// A FRAME'S PAINT ENDS WITH ITS REGION (runtime/core.ts `#apply`, `#morph_live`). A frame waits for
// its stylesheets before it paints; a region that leaves the page meanwhile never paints it. Its
// paint machine goes back to `idle` all the same: a machine left in `painting` waits for a paint
// that can no longer happen (found by the simulator: generated app 8, seed 24).
import { afterEach, expect, test } from 'vitest';
import { observe } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset, stamp, write } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';

/** A sheet that arrives in 300 ms; each test its own (a module loads once per page). */
const slow_sheet = (key: string) =>
	`<link rel="stylesheet" data-ogygia-region-css href="/test/browser/fixtures/slow-sheet.ts?${key}">`;
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		url?: string;
	}): Promise<void>;
};

/** The paint machine's state, as it last moved (one region per test). */
let paint = 'idle';
let off: (() => void) | null = null;

afterEach(() => {
	off?.();
	off = null;
	paint = 'idle';
	document.body.innerHTML = '';
	_reset();
});

function watch_paint(): void {
	off = observe((name, _from, to) => {
		if (name === 'region-paint') paint = to?.kind ?? 'stopped';
	});
}

test('a hole that leaves the page while its answer waits on a sheet ends its paint', async () => {
	const endpoint = '/__ogygia__?id=paintleft001&props=W3t9XQ&exp=9999999999&sig=stub';
	const a = frameAddress(endpoint);
	write({ a, v: stamp(), html: '<p data-tick>0</p>' });
	document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${endpoint}"><p>fallback</p></ogygia-region>`;
	const el = document.querySelector('ogygia-region')!;
	bootDev();
	await expect
		.poll(() => el.querySelector('[data-tick]')?.textContent, { timeout: 2_000 })
		.toBe('0');
	watch_paint();
	// a refresh that links a sheet still on its way, then the region leaves before it comes
	write({ a, v: stamp(), html: `${slow_sheet('hole')}<p data-tick>1</p>` });
	await expect.poll(() => paint, { timeout: 2_000 }).toBe('painting');
	el.remove();
	await tick(600);
	expect(paint, 'its paint is over').toBe('idle');
});

test('a static live region that leaves the page while its tick waits on a sheet ends its paint', async () => {
	const el = document.createElement('ogygia-region') as LiveRegion;
	el.setAttribute('live', '');
	document.body.append(el);
	bootDev();
	const url = '/__ogygia__?id=paintleft002&props=W3t9XQ&exp=9999999999&sig=stub';
	const live = (html: string) =>
		el.applyLive({ id: 'paintleft002', module: '', props: {}, html, url });
	await live('<p data-tick>0</p>');
	watch_paint();
	void live(`${slow_sheet('live')}<p data-tick>1</p>`);
	await expect.poll(() => paint, { timeout: 2_000 }).toBe('painting');
	el.remove();
	await tick(600);
	expect(paint, 'its paint is over').toBe('idle');
});
