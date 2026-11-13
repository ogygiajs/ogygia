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

	it('a field marked data-ogygia-no-keep (or inside one) starts blank on the return', () => {
		const typed = region('/k.js');
		typed.setAttribute('data-ogygia-no-keep', '');
		typed.value = 'one-time code';
		snapshot_forms(document.body, '/no-keep');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		const again = region('/k.js');
		arm_form_restore('/no-keep');

		expect(again.value).toBe('');
	});

	it('a restored field fires input and change, so a bound value follows', () => {
		const typed = region('/e.js');
		typed.value = 'bound';
		snapshot_forms(document.body, '/events');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		const again = region('/e.js');
		const heard: string[] = [];
		again.addEventListener('input', () => heard.push('input'));
		again.addEventListener('change', () => heard.push('change'));
		arm_form_restore('/events');

		expect(heard).toEqual(['input', 'change']);
	});

	it('an island that hydrates after the return, while its page is on screen, gets its field', () => {
		const typed = region('/w.js');
		typed.value = 'late';
		snapshot_forms(document.body, '/late');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		arm_form_restore('/late');
		const again = region('/w.js');
		again.parentElement!.dispatchEvent(new Event('ogygia:hydrated', { bubbles: true }));

		expect(again.value).toBe('late');
	});

	it("another page's restore opening ends this one's: one window at a time", () => {
		const typed = region('/y.js');
		typed.value = 'first page';
		snapshot_forms(document.body, '/first');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();
		region('/z.js').value = 'second page';
		snapshot_forms(document.body, '/second');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		arm_form_restore('/first');
		arm_form_restore('/second');
		const late = region('/y.js');
		late.parentElement!.dispatchEvent(new Event('ogygia:hydrated', { bubbles: true }));

		expect(late.value).toBe('');
	});

	it('a hole answer that puts a copy of an island before another names them again', () => {
		region('/d.js');
		const second = region('/d.js');
		second.value = 'second copy';
		snapshot_forms(document.body, '/copies');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		const kept = region('/d.js');
		kept.parentElement!.removeAttribute('data-hydrated');
		arm_form_restore('/copies');
		const brought = region('/d.js');
		document.body.insertBefore(brought.parentElement!, kept.parentElement);
		document.dispatchEvent(new Event('ogygia:server'));
		kept.parentElement!.dispatchEvent(new Event('ogygia:hydrated', { bubbles: true }));

		expect(kept.value).toBe('second copy');
	});

	it("leaving the page ends its restore: an island hydrating after that gets nothing of the old page's", () => {
		const typed = region('/x.js');
		typed.value = 'old page';
		snapshot_forms(document.body, '/left');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		arm_form_restore('/left');
		snapshot_forms(document.body, '/elsewhere');
		const next = region('/x.js');
		next.parentElement!.dispatchEvent(new Event('ogygia:hydrated', { bubbles: true }));

		expect(next.value).toBe('');
	});

	it("a field left at its server default takes the page's new default on the return", () => {
		const untouched = region('/d.js');
		untouched.defaultValue = 'old default';
		snapshot_forms(document.body, '/defaults');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		const back = region('/d.js');
		back.defaultValue = 'new default';
		arm_form_restore('/defaults');

		expect(back.value).toBe('new default');
	});

	it('a field typed in and then set back to its default leaves nothing to restore', () => {
		const typed = region('/e.js');
		typed.value = 'typed';
		snapshot_forms(document.body, '/reset');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		const back = region('/e.js');
		arm_form_restore('/reset');
		back.value = '';
		snapshot_forms(document.body, '/reset');
		for (const el of document.querySelectorAll('ogygia-region')) el.remove();

		const again = region('/e.js');
		again.defaultValue = 'new default';
		arm_form_restore('/reset');

		expect(again.value).toBe('new default');
	});
});
