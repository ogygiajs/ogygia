// Form continuity names a saved field's island by what it is (component and endpoint) and which
// copy of it it is, never by its place among the page's regions (#1337).
import { afterEach, describe, expect, it } from 'vitest';
import { arm_form_restore, snapshot_forms } from '../../src/runtime/form-continuity.ts';

/** A hydrated region of `entry` holding one text input. */
function region(entry: string, endpoint = '/islands'): HTMLInputElement {
	const el = document.createElement('ogygia-region');
	el.setAttribute('entry', entry);
	el.setAttribute('endpoint', endpoint);
	el.setAttribute('data-hydrated', '');
	const input = document.createElement('input');
	el.append(input);
	document.body.append(el);
	return input;
}

afterEach(() => {
	for (const el of document.querySelectorAll('ogygia-region')) el.remove();
});

describe('form continuity', () => {
	it('restores a field into its own island when another island now comes first', () => {
		region('/a.js');
		const typed = region('/b.js');
		typed.value = 'hello';
		snapshot_forms(document.body, '/page');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		// back on the page: a new island now sits before the one the visitor typed in
		const first = region('/c.js');
		region('/a.js');
		const again = region('/b.js');
		arm_form_restore('/page');

		expect(again.value).toBe('hello');
		expect(first.value).toBe('');
	});

	it('restores into the same copy of an island that is on the page twice', () => {
		region('/b.js');
		const second = region('/b.js');
		second.value = 'two';
		snapshot_forms(document.body, '/twice');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		region('/a.js');
		const one = region('/b.js');
		const two = region('/b.js');
		arm_form_restore('/twice');

		expect(one.value).toBe('');
		expect(two.value).toBe('two');
	});

	it('restores into a hole whose props changed between the visits (its name is never its props)', () => {
		const typed = region('/h.js', '/__ogygia__?id=card&props=AAAA&exp=1&sig=x');
		typed.value = 'kept';
		snapshot_forms(document.body, '/props');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		const again = region('/h.js', '/__ogygia__?id=card&props=BBBB&exp=2&sig=y');
		arm_form_restore('/props');

		expect(again.value).toBe('kept');
	});

	it('names a region the same before and after the runtime pins its relative URLs', () => {
		const typed = region('./h.js', './__ogygia__?id=card&props=AAAA');
		typed.value = 'pinned';
		snapshot_forms(document.body, '/pin');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		const base = new URL('.', location.href).pathname;
		const again = region(`${base}h.js`, `${base}__ogygia__?id=card&props=AAAA`);
		arm_form_restore('/pin');

		expect(again.value).toBe('pinned');
	});
});
