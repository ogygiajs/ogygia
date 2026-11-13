// An island's hydrate lifts its lakes out and gives them back by position (src/runtime/lakes.ts
// `restore`). When the island rendered a different number of lakes than it had, a lake's content was
// dropped with no word: `rule_lake_restored` says so in dev and at the end of every e2e test.
import { expect, test } from 'vitest';
import { lift, restore } from '../../src/runtime/lakes.ts';
import { install_rules, runtime_rules } from '../../src/runtime/rules.ts';

install_rules(false);
const lake_rule = () => runtime_rules.broken().filter((b) => b.code === 'rule_lake_restored');

const LAKE = (id: string) =>
	`<ogygia-region wake="none" entry="${id}"><p data-${id}>${id}</p></ogygia-region>`;

test('a hydrate that gives back every lake it lifted breaks no rule', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-a">${LAKE('one')}${LAKE('two')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-a"]')!;
	restore(host, lift(host));
	expect(document.querySelector('[data-two]')).not.toBeNull();
	expect(lake_rule()).toEqual([]);
});

test('a hydrate that rendered one lake fewer than it lifted is a broken rule', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-b">${LAKE('one')}${LAKE('two')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-b"]')!;
	const lifted = lift(host);
	host.querySelector('[entry="two"]')!.remove(); // the island's hydrate did not render it
	restore(host, lifted);
	expect(document.querySelector('[data-two]')).toBeNull(); // its content is gone
	expect(lake_rule().map((b) => b.detail)).toEqual([
		'host-b lifted 2 lake(s) and its hydrate rendered 1'
	]);
});
