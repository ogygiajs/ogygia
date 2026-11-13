// ONE CAPTURE PER ARMING (runtime/interaction.ts). A click on a sleeping island wakes it and is held
// for a replay once the island is live. If the region is taken out while its module loads and put
// back (a header that re-renders, a layout that moves a node), its old visit is over and the region
// arms a new capture. The old capture, settling later, must leave the new one alone: it must not
// disarm it (clicks in the new visit would no longer be caught, and an `interaction` island has no
// other trigger), and it must not replay its own clicks onto the new visit's markup.
import { expect, inject, test } from 'vitest';
import { observe } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';

const SLOW = '/test/browser/fixtures/slow-entry.ts';
const island = () =>
	decodeURIComponent(escape(atob(inject('counter_ssr_b64'))))
		.replace('wake="load"', 'wake="interaction"')
		.replace(/entry="[^"]*"/, `entry="${SLOW}"`);

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function click(el: Element): MouseEvent {
	const e = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
	el.dispatchEvent(e);
	return e;
}

test('a capture armed again while the first one’s wake loads catches the next click, and the first leaves it alone', async () => {
	document.body.innerHTML = island();
	const el = document.querySelector<HTMLElement>('ogygia-region')!;
	expect(el.getAttribute('entry')).toBe(SLOW);
	bootDev();
	const count = () => el.querySelector('[data-testid="count"]')!.textContent;
	expect(count()).toBe('3');
	// the first click wakes it: held for the replay, its module on its way (400 ms)
	expect(click(el.querySelector('button')!).defaultPrevented, 'the waking click is held').toBe(
		true
	);
	await tick(20);
	const moves: string[] = [];
	const off = observe((name, from, to) => {
		if (name === 'interaction-arming') moves.push(`${from?.kind} -> ${to?.kind}`);
	});
	const spot = el.nextSibling; // (its props sidecar: it goes back in front of it)
	el.remove();
	await tick(10); // out past its task: that visit is over
	off();
	expect(moves, 'the woken arming is over').toEqual(['woken -> over']);
	document.body.insertBefore(el, spot); // put back: its capture is armed again
	// the first visit's wake settles (its module came, its visit was over)
	await tick(700);
	expect(el.hasAttribute('data-hydrated'), 'the old visit did not hydrate it').toBe(false);
	expect(count(), 'the old capture replayed nothing onto the new visit').toBe('3');
	// a click in the new visit is caught by its capture, wakes it, and is replayed once it is live
	expect(click(el.querySelector('button')!).defaultPrevented, 'the new capture caught it').toBe(
		true
	);
	await expect.poll(() => el.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	await expect.poll(count, { timeout: 2_000 }).toBe('4');
	await tick(100);
	expect(count(), 'one replay: the click of the new visit').toBe('4');
});
