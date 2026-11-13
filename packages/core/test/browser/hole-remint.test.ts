import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../_frames.ts';

const ep = (id: string, props = 'W3t9XQ') =>
	`/__ogygia__?id=${id}&props=${props}&exp=9999999999&sig=stub`;
const hole = (endpoint: string, when = 'load') =>
	`<ogygia-region render="defer" when="${when}" endpoint="${endpoint}"><p data-fallback>loading</p></ogygia-region>`;
const html = (body: string) =>
	new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const real_fetch = window.fetch;
afterEach(() => {
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

type Live = { applyLive(desc: Record<string, unknown>): Promise<void> };

/** A static live region whose ticks render `markup`. */
function live_region(id: string): (markup: string) => Promise<void> {
	const live = document.createElement('ogygia-region');
	live.setAttribute('live', '');
	document.body.append(live);
	bootDev();
	return (markup) =>
		(live as unknown as Live).applyLive({
			id: `${id}-live`,
			module: '',
			props: {},
			html: markup,
			url: ep(`${id}live`)
		});
}

test('a refresh that renders a hole at the same address asks nothing new', async () => {
	const E = ep('remint000001');
	const calls: string[] = [];
	window.fetch = async (input) => {
		calls.push(String(input));
		return html('<p data-answer>answer</p>');
	};
	const tick_with = live_region('remint01');
	await tick_with(hole(E));
	await expect.poll(() => calls.length, { timeout: 5_000 }).toBe(1);
	await tick_with(hole(E));
	await tick(300);
	expect(calls).toHaveLength(1);
});

test('a refresh that re-mints a hole that never fetched leaves it to its own schedule', async () => {
	const never = '(min-width: 99999px)';
	const calls: string[] = [];
	window.fetch = async (input) => {
		calls.push(String(input));
		return html('<p data-answer>answer</p>');
	};
	const tick_with = live_region('remint02');
	await tick_with(hole(ep('remint000002', 'cHJvcHMx'), never));
	await tick_with(hole(ep('remint000002', 'cHJvcHMy'), never));
	await tick(300);
	expect(calls).toEqual([]);
});

test('a re-minted hole that has an answer does not retry a failed refresh', async () => {
	const calls: string[] = [];
	window.fetch = async (input) => {
		calls.push(String(input));
		return calls.length === 1
			? html('<p data-answer>first</p>')
			: new Response('', { status: 500 });
	};
	const tick_with = live_region('remint03');
	await tick_with(hole(ep('remint000003', 'cHJvcHMx')));
	await expect
		.poll(() => document.querySelector('[data-answer]') !== null, { timeout: 5_000 })
		.toBe(true);
	await tick_with(hole(ep('remint000003', 'cHJvcHMy')));
	await expect.poll(() => calls.length, { timeout: 5_000 }).toBe(2);
	await tick(1_500);
	expect(calls).toHaveLength(2);
});
