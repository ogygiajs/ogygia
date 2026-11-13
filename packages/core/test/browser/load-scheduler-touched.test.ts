import { expect, test } from 'vitest';
import { critical_outcome, LoadSlot } from '../../src/runtime/load-scheduler.ts';
import { after_document_painted } from '../../src/runtime/schedule.ts';

test('a click before the critical wait began means it waits on nothing', async () => {
	document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	const hero = document.createElement('img');
	hero.setAttribute('fetchpriority', 'high');
	Object.defineProperty(hero, 'complete', { configurable: true, get: () => false });
	document.body.append(hero);
	let started = false;
	void new LoadSlot({ kind: 'code', cls: 'visible' }).ready.then(() => (started = true));
	await after_document_painted();
	await new Promise((r) => setTimeout(r));
	expect(started).toBe(true);
	expect(critical_outcome()?.outcome).toBe('none');
	hero.remove();
});
