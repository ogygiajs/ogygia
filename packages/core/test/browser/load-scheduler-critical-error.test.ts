import { expect, test, beforeEach, afterEach } from 'vitest';
import {
	critical_outcome,
	LoadSlot,
	reset_load_scheduler
} from '../../src/runtime/load-scheduler.ts';
import { after_document_painted, reset_document_painted } from '../../src/runtime/schedule.ts';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
	reset_load_scheduler();
	reset_document_painted();
});
afterEach(() => {
	document.body.innerHTML = '';
});

test('a critical image that fails to load ends the wait as one that arrived: island code starts', async () => {
	const hero = document.createElement('img');
	hero.setAttribute('fetchpriority', 'high');
	Object.defineProperty(hero, 'complete', { configurable: true, get: () => false });
	document.body.appendChild(hero);
	let started = false;
	void new LoadSlot({ kind: 'code', cls: 'visible' }).ready.then(() => (started = true));
	await after_document_painted();
	await tick();
	expect(started).toBe(false);
	hero.dispatchEvent(new Event('error'));
	await tick();
	expect(started).toBe(true);
	expect(critical_outcome()).toEqual({
		outcome: 'arrived',
		resources: 1,
		waited_ms: expect.any(Number)
	});
});
