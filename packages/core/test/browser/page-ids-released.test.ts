// Every page id has an owner: each region whose island resolved it, or else the page itself. A
// navigation releases every id that nothing on the next page still owns.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { morph_children, install as install_morph } from '../../src/runtime/morph.ts';
import { reconcile_body } from '../../src/runtime/reconcile.ts';
import { record_server_body } from '../../src/runtime/ownership.ts';
import { capture_region_ids } from '../../src/runtime/region-ids.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { register_kind, resolve, dispose_ids } from '../../src/ref.ts';

install_morph();
link_boot();

let disposed: number[] = [];
register_kind({
	k: 'test-page-owned',
	match: (v) => typeof v === 'object' && v !== null && '__po' in (v as object),
	encode: (v) => ({ d: { n: (v as { n: number }).n } }),
	decode: (r) => ({ __po: true, n: (r.d as { n: number }).n }),
	dispose: (l) => disposed.push((l as { n: number }).n)
});

const ID = 'page-owned';
const ref = (n: number) => ({ k: 'test-page-owned', i: ID, d: { n } });

function parsed_body(html: string): HTMLElement {
	return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body;
}

function boot_page(keys: string[]): Element[] {
	document.body.innerHTML = keys
		.map((k) => `<ogygia-region data-key="${k}"><p>${k}</p></ogygia-region>`)
		.join('');
	record_server_body(document.body, document.body, Array.from(document.body.childNodes));
	return Array.from(document.body.querySelectorAll('ogygia-region'));
}

beforeEach(() => {
	disposed = [];
});
afterEach(() => {
	dispose_ids([ID]);
	document.body.replaceChildren();
});

test('a region that reunites with an object another region made owns it too', () => {
	const [a, b] = boot_page(['a', 'b']);
	capture_region_ids(a, () => resolve(ref(1), 'page'));
	// b's island decodes the same id: it reunites with a's instance
	capture_region_ids(b, () => resolve(ref(2), 'page'));
	reconcile_body(
		document.body,
		parsed_body('<ogygia-region data-key="b"><p>b</p></ogygia-region>'),
		morph_children
	);
	expect(disposed).toEqual([]);
});
