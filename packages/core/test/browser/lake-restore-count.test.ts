// An island's hydrate lifts its lakes out and gives each back to the lake with its key: its identity
// (`data-og-lake`) and its place among the lakes that share it (src/runtime/lakes.ts `restore`). When
// a lifted lake finds no lake to go back to, its content was dropped with no word:
// `rule_lake_restored` says so in dev and at the end of every e2e test.
import { expect, test } from 'vitest';
import { lift, restore } from '../../src/runtime/lakes.ts';
import { install_rules, runtime_rules } from '../../src/runtime/rules.ts';

install_rules(false);
const lake_rule = () => runtime_rules.broken().filter((b) => b.code === 'rule_lake_restored');

const LAKE = (id: string) =>
	`<ogygia-region wake="none" entry="${id}"><p data-${id}>${id}</p></ogygia-region>`;
const TWIN = (identity: string, tag: string) =>
	`<ogygia-region wake="none" entry="twin" data-og-lake="${identity}"><p data-tag="${tag}">${tag}</p></ogygia-region>`;

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
		'host-b lifted 2 lake(s) and found where 1 of them belong'
	]);
});

test('two lakes of one component go back to the lake with their own identity, whatever the order', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-c">${TWIN('aaaaaaaaaaaaaaaa', 'header')}${TWIN('bbbbbbbbbbbbbbbb', 'footer')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-c"]')!;
	const lifted = lift(host);
	const [header, footer] = host.querySelectorAll('[data-og-lake]');
	host.insertBefore(footer, header); // the hydrate rendered them the other way round
	restore(host, lifted);
	expect(host.querySelector('[data-og-lake="aaaaaaaaaaaaaaaa"] [data-tag]')!.textContent).toBe(
		'header'
	);
	expect(host.querySelector('[data-og-lake="bbbbbbbbbbbbbbbb"] [data-tag]')!.textContent).toBe(
		'footer'
	);
});

test('two lakes with one identity go back by their place among the lakes that share it', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-d">${TWIN('cccccccccccccccc', 'first')}${TWIN('cccccccccccccccc', 'second')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-d"]')!;
	restore(host, lift(host));
	expect([...host.querySelectorAll('[data-tag]')].map((p) => p.textContent)).toEqual([
		'first',
		'second'
	]);
});
