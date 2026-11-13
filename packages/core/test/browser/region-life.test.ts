// A REGION'S LIFETIME IN THE PAGE (runtime/region-machines.ts `region-life`): detached until it
// connects, scheduled once its connect armed what it waits for, detached again when it leaves for
// good. A move, out and back in one task, keeps its lifetime.
import { afterEach, expect, test } from 'vitest';
import { observe } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';

/** A hole's address, one per test (the frame store keeps an answer for the page). */
const endpoint = (id: string) =>
	`/__ogygia__?id=feedface0f${id}&props=W3t9XQ&exp=9999999999&sig=stub`;
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

/** Every `region-life` move, as `from -> to`. */
let moves: string[] = [];
// (watched for the whole file: each test reads the moves its own regions made)
observe((name, from, to) => {
	if (name === 'region-life') moves.push(`${from?.kind} -> ${to?.kind ?? 'stopped'}`);
});
const real_fetch = window.fetch;

afterEach(async () => {
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	// (the regions' teardowns run a microtask after they leave)
	await tick();
	moves = [];
});

/** Answers each request with the next status in `statuses` (the last one repeats). */
function serve(statuses: number[]): { calls: number } {
	const seen = { calls: 0 };
	window.fetch = async (input) => {
		const status = statuses[Math.min(seen.calls, statuses.length - 1)];
		seen.calls++;
		const res = new Response(status === 200 ? '<p data-testid="served">served</p>' : 'down', {
			status,
			headers: { 'content-type': 'text/html' }
		});
		Object.defineProperty(res, 'url', { value: new URL(String(input), location.href).href });
		return res;
	};
	return seen;
}

test('a region connects, schedules, and a move keeps its lifetime', async () => {
	serve([200]);
	document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${endpoint('01')}"><p>fallback</p></ogygia-region><div data-to></div>`;
	bootDev();
	const region = document.querySelector('ogygia-region')!;
	await expect.poll(() => region.querySelector('[data-testid="served"]')).not.toBeNull();
	expect(moves).toEqual(['detached -> connected', 'connected -> scheduled']);
	document.querySelector('[data-to]')!.append(region);
	await tick();
	expect(moves, 'a move is no removal').toEqual([
		'detached -> connected',
		'connected -> scheduled'
	]);
});

test('a scheduled region removed for good is detached once', async () => {
	serve([200]);
	document.body.innerHTML = `<div data-a><ogygia-region render="defer" when="visible" endpoint="${endpoint('02')}"><p>fallback</p></ogygia-region></div><div data-b></div>`;
	bootDev();
	const region = document.querySelector('ogygia-region')!;
	await expect.poll(() => moves).toContain('connected -> scheduled');
	// out, in, out again in one task: one lifetime ends, once
	region.remove();
	document.querySelector('[data-b]')!.append(region);
	region.remove();
	await tick();
	expect(moves).toEqual([
		'detached -> connected',
		'connected -> scheduled',
		'scheduled -> detached'
	]);
});

test('a live region that never scheduled leaves from connected', async () => {
	document.body.innerHTML = `<ogygia-region live><p>tick</p></ogygia-region>`;
	bootDev();
	await tick();
	expect(moves).toEqual(['detached -> connected']);
	document.querySelector('ogygia-region')!.remove();
	await tick();
	expect(moves).toEqual(['detached -> connected', 'connected -> detached']);
});

test('a hole whose fetch failed connects afresh for its retry', async () => {
	const seen = serve([503, 200]);
	document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${endpoint('03')}"><p>fallback</p></ogygia-region>`;
	bootDev();
	const region = document.querySelector('ogygia-region')!;
	await expect
		.poll(() => region.querySelector('[data-testid="served"]'), { timeout: 10_000 })
		.not.toBeNull();
	expect(seen.calls).toBe(2);
	expect(moves).toEqual([
		'detached -> connected',
		'connected -> scheduled',
		'scheduled -> connected',
		'connected -> scheduled'
	]);
});
