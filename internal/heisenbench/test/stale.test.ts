// A STALE EXEMPTION FAILS THE GATE: an exemption in internal/heisenbench/unmeasured.json whose id
// names no function in the source any more (renamed, moved, deleted) excuses nothing, and left in
// place it piles up. The gate lists them and fails until they are taken out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gone_exemptions } from '../src/stale.ts';

const fn = (id: string) => ({ id });
const ex = (id: string) => ({ id, reason: 'why' });

test('an exemption that names no function in the inventory is gone', () => {
	const inventory = { functions: [fn('a.ts > one'), fn('a.ts > two')] };
	const exempt = [ex('a.ts > one'), ex('a.ts > gone'), ex('b.ts > moved')];
	assert.deepEqual(
		gone_exemptions(exempt, inventory).map((e) => e.id),
		['a.ts > gone', 'b.ts > moved']
	);
});

test('none gone: an empty list', () => {
	assert.deepEqual(gone_exemptions([ex('a.ts > one')], { functions: [fn('a.ts > one')] }), []);
});
