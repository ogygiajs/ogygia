// The hydration scheduler's drain picks the next turn from its two heaps on the word of its count
// (src/runtime/schedule.ts `drain`). `rule_turns_counted` (#1478) holds the count to the turns held,
// each in the heap its snapshot names: it holds through requests, picks and a region leaving, and a
// count that drifts is a broken rule, not a TypeError in a task of its own.
import { expect, test } from 'vitest';
import {
	hydrate_turn,
	PendingTurns,
	register_region,
	schedule_idle,
	turns_counted,
	unregister_region,
	type Turn
} from '../../src/runtime/schedule.ts';
import { install_rules, runtime_rules } from '../../src/runtime/rules.ts';
import { scope } from '@ogygia/machine';

install_rules(false);
const turns_rule = () => runtime_rules.broken().filter((b) => b.code === 'rule_turns_counted');

const region = (entry: string): Element => {
	const el = document.createElement('ogygia-region');
	el.setAttribute('entry', entry);
	document.body.append(el);
	return el;
};

test('turns requested, picked, and dropped as their region leaves: the count holds', async () => {
	const owner = scope();
	const [a, b, c] = ['a', 'b', 'c'].map(region);
	for (const el of [a, b, c]) register_region(el, owner);
	const turns = [hydrate_turn(a), hydrate_turn(b), hydrate_turn(c), hydrate_turn(c)];
	expect(turns_rule()).toEqual([]);
	unregister_region(c);
	expect(turns_rule()).toEqual([]);
	await Promise.all(turns);
	await expect.poll(() => schedule_idle()).toBe(true);
	expect(turns_rule()).toEqual([]);
	owner.close();
	document.body.innerHTML = '';
});

const turn = (el: Element, vis: boolean): Turn => ({
	el,
	order: 0,
	seq: 0,
	queued_at: 0,
	resolve: () => {},
	vis,
	done: false
});

test('a count that drifts from the turns held is a broken rule', () => {
	const el = region('drift');
	const p = new PendingTurns();
	const t = turn(el, false);
	p.turns_of.set(el, [t]);
	p.heap_rest.push(t);
	p.count = 1;
	expect(turns_counted(p)).toBeNull();
	p.count = 2;
	expect(turns_counted(p)).toBe('the scheduler counts 2 pending turn(s) and holds 1');
	p.count = 1;
	t.vis = true; // its snapshot moved it, and no entry was filed in the viewport heap
	expect(turns_counted(p)).toBe('a turn of drift is not in the viewport heap its snapshot names');
	t.done = true;
	expect(turns_counted(p)).toBe('a taken turn of drift is still held');
	el.remove();
});
