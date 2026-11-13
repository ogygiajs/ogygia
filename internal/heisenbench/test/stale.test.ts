// A STALE EXEMPTION FAILS THE GATE: an exemption in internal/heisenbench/unmeasured.json whose id
// names no function in the source any more (renamed, moved, deleted) excuses nothing, and left in
// place it piles up. The gate lists them and fails until they are taken out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gone_exemptions, unexempted_new_functions } from '../src/stale.ts';

const fn = (id: string) => ({ id });
const ex = (id: string) => ({ id, reason: 'why' });
// (Heisenbench identity.ts: the id without shape hashes and order suffixes)
const context_path = (id: string) => id.replace(/(?:~[0-9a-f]{6})?(?:#\d+)?(?= > |$)/g, '');

test('an exemption that names no function in the inventory is gone', () => {
	const inventory = { functions: [fn('a.ts > one'), fn('a.ts > two')] };
	const exempt = [ex('a.ts > one'), ex('a.ts > gone'), ex('b.ts > moved')];
	assert.deepEqual(
		gone_exemptions(exempt, inventory, context_path).map((e) => e.id),
		['a.ts > gone', 'b.ts > moved']
	);
});

test('an exemption naming a place (no shape hash) names the functions there', () => {
	const inventory = { functions: [fn('a.ts > flights:0~3fa9c2 > run')] };
	const exempt = [ex('a.ts > flights:0 > run'), ex('a.ts > flights:1 > run')];
	assert.deepEqual(
		gone_exemptions(exempt, inventory, context_path).map((e) => e.id),
		['a.ts > flights:1 > run']
	);
});

test('an exemption naming the call a function sits in names it (an enclosing exemption)', () => {
	const inventory = { functions: [fn('a.ts > flights:0~3fa9c2 > run')] };
	assert.deepEqual(
		gone_exemptions([ex('a.ts > flights:0'), ex('a.ts')], inventory, context_path).map((e) => e.id),
		['a.ts']
	);
});

test('none gone: an empty list', () => {
	assert.deepEqual(
		gone_exemptions([ex('a.ts > one')], { functions: [fn('a.ts > one')] }, context_path),
		[]
	);
});

test('ids-only: a function the base does not have and no exemption names is listed', () => {
	const base = { functions: [fn('a.ts > one')] };
	const now = { functions: [fn('a.ts > one'), fn('a.ts > two'), fn('b.ts > three')] };
	assert.deepEqual(
		unexempted_new_functions(now, base, [ex('b.ts > three')], context_path).map((f) => f.id),
		['a.ts > two']
	);
});

test('a function whose shape hash changed is not new: its place is in the base', () => {
	const base = { functions: [fn('a.ts > flights:0~111111 > run')] };
	const now = { functions: [fn('a.ts > flights:0~222222 > run')] };
	assert.deepEqual(unexempted_new_functions(now, base, [], context_path), []);
});

test('an exemption of the call a new function sits in covers it', () => {
	const base = { functions: [] };
	const now = { functions: [fn('a.ts > table:0~3fa9c2 > run')] };
	assert.deepEqual(unexempted_new_functions(now, base, [ex('a.ts > table:0')], context_path), []);
});
