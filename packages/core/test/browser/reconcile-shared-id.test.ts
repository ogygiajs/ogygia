// A SHARED OBJECT IS RELEASED ONLY WHEN NO REGION ON THE PAGE STILL HOLDS IT (#815). Two regions
// that share one live object (a wired class instance, a store passed to both) both own its page id.
// A navigation that keeps one and removes the other must not dispose the object the kept one still
// shows; one that removes both does.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { morph_children, install as install_morph } from '../../src/runtime/morph.ts';
import { reconcile_body } from '../../src/runtime/reconcile.ts';
import { record_server_body } from '../../src/runtime/ownership.ts';
import { record_region_id } from '../../src/runtime/region-ids.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { register_kind, resolve, dispose_ids } from '../../src/ref.ts';

install_morph();
link_boot();

let disposed: number[] = [];
register_kind({
	k: 'test-shared815',
	match: (v) => typeof v === 'object' && v !== null && '__s815' in (v as object),
	encode: (v) => ({ d: { n: (v as { n: number }).n } }),
	decode: (r) => ({ __s815: true, n: (r.d as { n: number }).n }),
	dispose: (l) => disposed.push((l as { n: number }).n)
});

const ID = 'shared-815';

function parsed_body(html: string): HTMLElement {
	return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body;
}

/** A page with regions keyed `keys`, each owning the shared object's page id. */
function boot_page(keys: string[]): void {
	document.body.innerHTML = keys
		.map((k) => `<ogygia-region data-key="${k}"><p>${k}</p></ogygia-region>`)
		.join('');
	record_server_body(document.body, document.body, Array.from(document.body.childNodes));
	resolve({ k: 'test-shared815', i: ID, d: { n: 1 } }, 'page');
	for (const el of document.body.querySelectorAll('ogygia-region')) record_region_id(el, ID);
}

beforeEach(() => {
	disposed = [];
});
afterEach(() => {
	dispose_ids([ID]);
	document.body.replaceChildren();
});

test('removing one of two regions that share an object keeps the object for the kept one', () => {
	boot_page(['a', 'b']);
	reconcile_body(
		document.body,
		parsed_body('<ogygia-region data-key="a"><p>a</p></ogygia-region>'),
		morph_children
	);
	expect(disposed).toEqual([]);
	// the next region carrying the same id reunites with the kept instance
	const again = resolve({ k: 'test-shared815', i: ID, d: { n: 99 } }, 'page') as { n: number };
	expect(again.n).toBe(1);
});

test('removing every region that holds an object disposes it', () => {
	boot_page(['a', 'b']);
	reconcile_body(document.body, parsed_body('<main>next</main>'), morph_children);
	expect(disposed).toEqual([1]);
});
