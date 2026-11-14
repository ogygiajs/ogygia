// A region authored in a lake that connects while its host island still sleeps waits on the lake
// (session.ts `LAKE`: `waited`). The host's hydrate adopts the lake in place and releases it after:
// the waiters run then, so the lake is settled, with nobody left to wake. Found by the sim (gen 550: a visible host below the fold; `stuck`: "lake#1 settling").
import { expect, test } from 'vitest';
import { hold, release } from '../../src/runtime/lakes.ts';
import { runtime_session } from '../../src/runtime/session.ts';

test('a lake its host puts back is settled, with nobody left waiting, when a region waited in it', () => {
	document.body.innerHTML = `<ogygia-region wake="visible" data-host><ogygia-region wake="none" entry="own"><p>own</p><!----></ogygia-region><ogygia-snippet style="display:contents"><ogygia-region wake="none" entry="live"><p>live</p><!----></ogygia-region></ogygia-snippet></ogygia-region>`;
	const host = document.querySelector('[data-host]')!;
	const own = document.querySelector('[entry="own"]')!;
	const live = document.querySelector('[entry="live"]')!;
	// (a region inside each connected first, with the host asleep)
	expect(runtime_session.wait_on_lake(own)).toBe(true);
	expect(runtime_session.wait_on_lake(live)).toBe(true);

	release(host, hold(host));

	expect(runtime_session.lake_settled(own)).toBe(true);
	expect(runtime_session.lake_settled(live)).toBe(true);
	// (a later refresh of the lake has no waiter to wake: they ran when the content came back)
	expect(runtime_session.wake_lake(own)).toBe(false);
	expect(runtime_session.wake_lake(live)).toBe(false);
});
