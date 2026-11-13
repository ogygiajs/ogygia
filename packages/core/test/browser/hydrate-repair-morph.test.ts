// With the morph in the build, a repair whose elements no longer match the server's goes through
// it: the elements it can match keep their identity, and it takes the server's sequence exactly,
// a web component's own children included.
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { repair_if_drifted } from '../../src/runtime/hydrate-core.ts';

beforeAll(() => {
	link_boot();
	install_morph();
});
beforeEach(() => {
	document.body.innerHTML = '';
});

function region_of(live: string): HTMLElement {
	const el = document.createElement('ogygia-region');
	el.innerHTML = live;
	document.body.append(el);
	return el;
}

test('an element whose children lost or gained an element is morphed: what it still has is kept', () => {
	const r = region_of('<div><b>k</b><i>added</i></div>');
	const b = r.querySelector('b');
	expect(repair_if_drifted(r, '<div><b>k</b></div>').repaired).toBe(true);
	expect(r.innerHTML).toBe('<div><b>k</b></div>');
	expect(r.querySelector('b'), 'the same element').toBe(b);
});

test('the island’s own elements differing, the morph takes the server’s sequence exactly', () => {
	const r = region_of('<details><summary>s</summary><i>own</i></details><b>extra</b>');
	expect(repair_if_drifted(r, '<details><summary>s</summary></details>').repaired).toBe(true);
	expect(r.innerHTML).toBe('<details><summary>s</summary></details>');
});
