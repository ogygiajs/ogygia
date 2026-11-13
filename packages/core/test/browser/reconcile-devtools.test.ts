// The navigation's reconcile names each region's fate for the devtools: kept, patched (same slot,
// other props), mounted, removed, each with its component and schedule.
// (devtools on for this file: the gate is read off the global when the module is first imported)
import { expect, test } from 'vitest';

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const { morph_children, install: install_morph } = await import('../../src/runtime/morph.ts');
const { reconcile_body } = await import('../../src/runtime/reconcile.ts');
const { link_boot } = await import('../../src/runtime/boot-link.ts');
const { snapshot, clear, configure } = await import('../../src/events/bus.ts');

install_morph();
link_boot();

test('each region’s fate under a navigation is one nav.reconcile event', () => {
	configure({ active: true, cap: 4096 });
	clear();
	document.body.innerHTML = [
		'<ogygia-region data-key="a" entry="./a.js" wake="load"></ogygia-region>',
		'<ogygia-region data-key="b" entry="./b.js" wake="idle"></ogygia-region>',
		'<ogygia-region data-key="c" entry="./c.js" wake="visible"></ogygia-region>'
	].join('');
	const next = new DOMParser().parseFromString(
		[
			'<!doctype html><body>',
			'<ogygia-region data-key="a" entry="./a.js" wake="load"></ogygia-region>',
			'<ogygia-region data-key="b2" entry="./b.js" wake="idle"></ogygia-region>',
			'<ogygia-region data-key="d" entry="./d.js" wake="interaction"></ogygia-region>'
		].join(''),
		'text/html'
	).body;
	reconcile_body(document.body, next, morph_children);
	const fates = snapshot()
		.filter((e) => e.name === 'nav.reconcile')
		.map((e) => {
			const { key, decision, entry, wake } = e as unknown as Record<string, unknown>;
			return { key, decision, entry, wake };
		});
	expect(fates).toEqual([
		{ key: 'a', decision: 'keep', entry: './a.js', wake: 'load' },
		{ key: 'b2', decision: 'patch', entry: './b.js', wake: 'idle' },
		{ key: 'c', decision: 'remove', entry: './c.js', wake: 'visible' },
		{ key: 'd', decision: 'mount', entry: './d.js', wake: 'interaction' }
	]);
	document.body.replaceChildren();
});
