// What `runtime/drift-watch.ts` states, against the source, in a real browser: a change inside a part
// Svelte's walk never reads does not mark the island; DOM work after the last sleeping island woke is
// not recorded; with no MutationObserver every island compares.
import { afterEach, expect, it, vi } from 'vitest';
import { scope } from '@ogygia/machine';
import { region_changed, watch_region } from '../../src/runtime/drift-watch.ts';
import { OG_OPAQUE } from '../../src/wire-markup.ts';

const made: Element[] = [];
afterEach(() => {
	for (const el of made.splice(0)) el.remove();
	vi.unstubAllGlobals();
});

function region(html: string): HTMLElement {
	const el = document.createElement('ogygia-region');
	el.innerHTML = html;
	document.body.append(el);
	made.push(el);
	return el;
}

it('a change inside a part Svelte never walks does not mark the island', () => {
	const r = region(`<div ${OG_OPAQUE}><p>widget</p></div><p>walked</p>`);
	const sleep = scope();
	watch_region(sleep, r);
	r.querySelector(`[${OG_OPAQUE}] p`)!.firstChild!.nodeValue = 'reworked';
	expect(region_changed(r)).toBe(false);
	sleep.close();
});

it('a change inside a nested region marks its host, but not past a part Svelte never walks', () => {
	const r = region(`<div ${OG_OPAQUE}><ogygia-region><p>a</p></ogygia-region></div>`);
	const inner = r.querySelector('ogygia-region')!;
	const sleep = scope();
	watch_region(sleep, r);
	inner.querySelector('p')!.firstChild!.nodeValue = 'b';
	expect(region_changed(inner)).toBe(true);
	expect(region_changed(r)).toBe(false);
	sleep.close();
});

it('DOM work after the last sleeping island woke is not recorded', () => {
	const r = region('<p>awake</p>');
	const woke = scope();
	watch_region(woke, r);
	woke.close();
	r.append(document.createElement('span'));
	const sleep = scope();
	watch_region(sleep, r);
	expect(region_changed(r)).toBe(false);
	sleep.close();
});

it('with no MutationObserver every island compares', async () => {
	vi.stubGlobal('MutationObserver', undefined);
	// (a second copy of the module, evaluated with no MutationObserver)
	const fresh = (await import(
		// @ts-expect-error -- a query makes the browser load a second copy
		'../../src/runtime/drift-watch.ts?no-observer'
	)) as typeof import('../../src/runtime/drift-watch.ts');
	const r = region('<p>untouched</p>');
	const sleep = scope();
	fresh.watch_region(sleep, r);
	expect(fresh.region_changed(r)).toBe(true);
	sleep.close();
});
