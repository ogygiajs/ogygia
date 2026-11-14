// An island's hydrate adopts its lakes in place. It holds each by its key (its identity, `data-og-lake`,
// and its place among the lakes that share it) and finds it again after (src/runtime/lakes.ts
// `release`). A lake the hydrate created fresh takes the content of the one it held under that key.
// When a held lake is not found again, its content was dropped with no word: `rule_lake_restored`
// says so in dev and at the end of every e2e test.
import { expect, test } from 'vitest';
import { hold, release } from '../../src/runtime/lakes.ts';
import { install_rules, runtime_rules } from '../../src/runtime/rules.ts';

install_rules(false);
const lake_rule = () => runtime_rules.broken().filter((b) => b.code === 'rule_lake_restored');

const LAKE = (id: string) =>
	`<ogygia-region wake="none" entry="${id}"><p data-${id}>${id}</p></ogygia-region>`;
const TWIN = (identity: string, tag: string) =>
	`<ogygia-region wake="none" entry="twin" data-og-lake="${identity}"><p data-tag="${tag}">${tag}</p></ogygia-region>`;

test('a hydrate that keeps every lake it held breaks no rule, and moves nothing', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-a">${LAKE('one')}${LAKE('two')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-a"]')!;
	const two = document.querySelector('[data-two]');
	const held = hold(host);
	expect(document.querySelector('[data-two]'), 'held in place').toBe(two);
	release(host, held);
	expect(document.querySelector('[data-two]')).toBe(two);
	expect(lake_rule()).toEqual([]);
});

test('a hydrate that rendered one lake fewer than it held is a broken rule', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-b">${LAKE('one')}${LAKE('two')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-b"]')!;
	const held = hold(host);
	host.querySelector('[entry="two"]')!.remove();
	release(host, held);
	expect(document.querySelector('[data-two]')).toBeNull();
	expect(lake_rule().map((b) => b.detail)).toEqual([
		'host-b held 2 lake(s) and found 1 of them after its hydrate'
	]);
});

test('a lake the hydrate created fresh takes the content of the one it held under its key', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-e">${LAKE('one')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-e"]')!;
	const p = document.querySelector('[data-one]');
	const held = hold(host);
	const fresh = document.createElement('ogygia-region');
	fresh.setAttribute('wake', 'none');
	fresh.setAttribute('entry', 'one');
	host.querySelector('[entry="one"]')!.replaceWith(fresh);
	release(host, held);
	expect(fresh.querySelector('[data-one]')).toBe(p);
	expect(lake_rule().filter((b) => b.detail.startsWith('host-e'))).toEqual([]);
});

test('two lakes of one component keep their own content, whatever order the hydrate left them in', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-c">${TWIN('aaaaaaaaaaaaaaaa', 'header')}${TWIN('bbbbbbbbbbbbbbbb', 'footer')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-c"]')!;
	const held = hold(host);
	const [header, footer] = host.querySelectorAll('[data-og-lake]');
	host.insertBefore(footer, header);
	release(host, held);
	expect(host.querySelector('[data-og-lake="aaaaaaaaaaaaaaaa"] [data-tag]')!.textContent).toBe(
		'header'
	);
	expect(host.querySelector('[data-og-lake="bbbbbbbbbbbbbbbb"] [data-tag]')!.textContent).toBe(
		'footer'
	);
});

test('two lakes with one identity keep their content by their place among the lakes that share it', () => {
	document.body.innerHTML = `<ogygia-region wake="load" entry="host-d">${TWIN('cccccccccccccccc', 'first')}${TWIN('cccccccccccccccc', 'second')}</ogygia-region>`;
	const host = document.querySelector('[entry="host-d"]')!;
	release(host, hold(host));
	expect([...host.querySelectorAll('[data-tag]')].map((p) => p.textContent)).toEqual([
		'first',
		'second'
	]);
});
