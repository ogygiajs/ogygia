// ONE NOTION OF "ON SCREEN" (#444). The load scheduler classes a region with no box of its own (its
// content is `position: fixed`, or it is `display: contents`) by what it renders, so a fixed button
// on screen downloads as `visible` (load-scheduler.test.ts, a field report). Its `when: 'visible'`
// and the hydrate scheduler's snapshot watched the region's own box instead, which says nothing for
// such a region: the button the visitor sees was `visible` to the one and never on screen to the
// other, so its fetch never came. Every feature now reads one tracker, with one rule.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import { viewport_class } from '../../src/runtime/load-scheduler.ts';

const ep = (id: string) => `/__ogygia__?id=${id}&props=W3t9XQ&exp=9999999999&sig=stub`;
const real_fetch = window.fetch;
const asked: string[] = [];

beforeEach(() => {
	document.body.innerHTML = '';
	asked.length = 0;
	window.fetch = async (input) => {
		asked.push(String(input));
		return new Response('<p data-answer>answer</p>', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	};
});
afterEach(() => {
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

test('a visible hole whose content is a fixed button on screen fetches, as the load class says', async () => {
	// the region sits at the end of a long page; the button it renders is fixed at the top
	document.body.innerHTML = `<div style="height:${innerHeight * 4}px"></div><ogygia-region render="defer" when="visible" endpoint="${ep('view00000001')}"><button style="position:fixed;top:64px;left:8px">open</button></ogygia-region>`;
	const region = document.querySelector('ogygia-region')!;
	expect(viewport_class(region), 'the load scheduler sees it on screen').toBe('visible');
	bootDev();
	await expect
		.poll(() => asked.length, {
			timeout: 3_000,
			message: 'its `visible` schedule never saw the button on screen'
		})
		.toBe(1);
});

test('a visible hole that is display: contents fetches when what it renders is on screen', async () => {
	document.body.innerHTML = `<ogygia-region render="defer" when="visible" style="display:contents" endpoint="${ep('view00000002')}"><p style="margin:0">fallback</p></ogygia-region>`;
	const region = document.querySelector('ogygia-region')!;
	expect(viewport_class(region), 'the load scheduler sees it on screen').toBe('visible');
	bootDev();
	await expect
		.poll(() => asked.length, {
			timeout: 3_000,
			message: 'its `visible` schedule never saw what it renders on screen'
		})
		.toBe(1);
});

test('a visible hole off screen with its fixed content off screen too waits', async () => {
	document.body.innerHTML = `<div style="height:${innerHeight * 4}px"></div><ogygia-region render="defer" when="visible" endpoint="${ep('view00000003')}"><button style="position:fixed;top:${innerHeight + 200}px">far</button></ogygia-region>`;
	const region = document.querySelector('ogygia-region')!;
	expect(viewport_class(region)).toBe('ahead');
	bootDev();
	await new Promise((r) => setTimeout(r, 500));
	expect(asked).toEqual([]);
});
