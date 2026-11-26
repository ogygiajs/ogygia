// A view transition pairs the elements of two pages by name, so a name on a page is one element's.
// When two elements share one, the browser skips the whole transition (every element of it, not
// the pair) and prints a line most people never see: two `<Img morph>` of one source on a page do
// exactly that. `rule_transition_name_unique` says so in dev and at the end of every e2e test.
import { expect, test } from 'vitest';
import { install_rules, runtime_rules } from '../../src/runtime/rules.ts';

install_rules(false);
const name_rule = () =>
	runtime_rules.broken().filter((b) => b.code === 'rule_transition_name_unique');

test('a page whose view-transition names are each one element breaks no rule', () => {
	document.body.innerHTML = `<img style="view-transition-name:og-img-a1" alt=""><img style="view-transition-name: og-img-b2" alt=""><img alt="">`;
	expect(name_rule()).toEqual([]);
});

test('a name repeated on an element that is not rendered breaks no rule (a mobile sheet beside a hidden sidebar)', () => {
	document.body.innerHTML = `<nav style="view-transition-name: og-sidebar"></nav><aside style="display:none"><nav style="view-transition-name: og-sidebar"></nav></aside><nav style="display:none;view-transition-name: og-sidebar"></nav>`;
	expect(name_rule()).toEqual([]);
});

test('two elements with one view-transition name are a broken rule, naming it', () => {
	document.body.innerHTML = `<img style="background:red;view-transition-name:og-img-a1" alt=""><p>x</p><img style="view-transition-name: og-img-a1" alt=""><img style="view-transition-name:none" alt=""><img style="view-transition-name:none" alt="">`;
	expect(name_rule().map((b) => b.detail)).toEqual([
		'2 elements share the view-transition name og-img-a1'
	]);
});
