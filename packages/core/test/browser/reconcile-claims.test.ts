// What the navigation's reconcile states about a region's key, a kept region's props and
// fingerprint, and the ids the body swap lets go, each on its own (runtime/reconcile.ts).
import { afterEach, beforeEach, expect, test } from 'vitest';
import { morph_children, install as install_morph } from '../../src/runtime/morph.ts';
import {
	fingerprint_of,
	reconcile_body,
	stamp_region_keys,
	swap_body
} from '../../src/runtime/reconcile.ts';
import { record_server_body } from '../../src/runtime/ownership.ts';
import { capture_region_ids } from '../../src/runtime/region-ids.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { dispose_ids, register_kind, resolve } from '../../src/ref.ts';

install_morph();
link_boot();

function body(html: string): HTMLElement {
	const b = document.createElement('body');
	b.innerHTML = html;
	return b;
}
function parsed_body(html: string): HTMLElement {
	return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body;
}
const keys = (b: Element) =>
	[...b.querySelectorAll('ogygia-region')].map((r) => r.getAttribute('data-key'));

let disposed: number[] = [];
register_kind({
	k: 'test-reconcile-owned',
	match: (v) => typeof v === 'object' && v !== null && '__ro' in (v as object),
	encode: (v) => ({ d: { n: (v as { n: number }).n } }),
	decode: (r) => ({ __ro: true, n: (r.d as { n: number }).n }),
	dispose: (l) => disposed.push((l as { n: number }).n)
});
const ID = 'reconcile-owned';

beforeEach(() => {
	disposed = [];
});
afterEach(() => {
	dispose_ids([ID]);
	document.body.replaceChildren();
});

test('an authored data-key or id is the key: it is left as it is', () => {
	const b = body(
		'<ogygia-region entry="./a.js" data-key="mine"></ogygia-region><ogygia-region entry="./a.js" id="named"></ogygia-region><div data-ogygia-keep="side" data-key="chrome"></div><div data-ogygia-keep="side2" id="chrome2"></div>'
	);
	stamp_region_keys(b);
	expect(keys(b)).toEqual(['mine', null]);
	expect(b.querySelector('[data-ogygia-keep="side"]')!.getAttribute('data-key')).toBe('chrome');
	expect(b.querySelector('#chrome2')!.hasAttribute('data-key')).toBe(false);
});

test('a kept region keys by its keep name, a persisted one by its slot, keep-chrome by its keep name', () => {
	const b = body(
		'<ogygia-region entry="./a.js" data-ogygia-keep="player" data-og-fp="1111111111111111"></ogygia-region><ogygia-region entry="./b.js" data-persist data-og-fp="2222222222222222"></ogygia-region><nav data-ogygia-keep="menu"></nav>'
	);
	stamp_region_keys(b);
	const [kept, persisted] = keys(b);
	expect(kept).toBe('k\0player');
	expect(persisted!.startsWith('p\0')).toBe(true);
	expect(persisted).not.toContain('2222222222222222');
	expect(b.querySelector('nav')!.getAttribute('data-key')).toBe('k\0menu');
});

test('an empty data-og-fp is no fingerprint: the region’s is worked out', () => {
	const b = body('<ogygia-region entry="./a.js" data-og-fp=""></ogygia-region>');
	stamp_region_keys(b);
	expect(keys(b)).toEqual([`r\0${fingerprint_of('./a.js', '', '')}`]);
});

test('identical copies are named by their place among the copies', () => {
	const twin = '<ogygia-region entry="./a.js" data-og-fp="0123456789abcdef"></ogygia-region>';
	const b = body(twin + twin + twin);
	stamp_region_keys(b);
	expect(keys(b)).toEqual([
		'r\x000123456789abcdef',
		'r\x000123456789abcdef 1',
		'r\x000123456789abcdef 2'
	]);
});

type Absorbing = Element & { absorbKeptProps?: (incoming: Element) => void; absorbed?: Element[] };
function absorbing(el: Element): Absorbing[] {
	const out = [...el.querySelectorAll('ogygia-region')] as Absorbing[];
	for (const r of out) {
		r.absorbed = [];
		r.absorbKeptProps = (incoming) => r.absorbed!.push(incoming);
	}
	return out;
}

test('a kept region takes the props and fingerprint of the first incoming region with its key', () => {
	document.body.innerHTML =
		'<ogygia-region data-key="k" data-og-fp="aaaa"><p>live</p></ogygia-region>';
	record_server_body(document.body, document.body, Array.from(document.body.childNodes));
	const [live] = absorbing(document.body);
	const next = parsed_body(
		'<ogygia-region data-key="k" data-og-fp="bbbb"><p>one</p></ogygia-region><ogygia-region data-key="k" data-og-fp="cccc"><p>two</p></ogygia-region>'
	);
	const first = next.querySelector('ogygia-region');
	reconcile_body(document.body, next, morph_children);
	expect(live.absorbed).toEqual([first]);
	expect(live.getAttribute('data-og-fp')).toBe('bbbb');
});

test('a kept region whose incoming twin has no fingerprint loses its own', () => {
	document.body.innerHTML =
		'<ogygia-region data-key="k" data-og-fp="aaaa"><p>live</p></ogygia-region>';
	record_server_body(document.body, document.body, Array.from(document.body.childNodes));
	const [live] = absorbing(document.body);
	reconcile_body(
		document.body,
		parsed_body('<ogygia-region data-key="k"><p>next</p></ogygia-region>'),
		morph_children
	);
	expect(live.hasAttribute('data-og-fp')).toBe(false);
});

test('a reconcile toward the live body itself pushes no props into a region from itself', () => {
	document.body.innerHTML = '<ogygia-region data-key="k"><p>live</p></ogygia-region>';
	const [live] = absorbing(document.body);
	reconcile_body(document.body, document.body, () => {});
	expect(live.absorbed).toEqual([]);
});

test('the body swap keeps the ids of a region inside the page’s own children', () => {
	document.body.innerHTML = '<main><p>server</p></main>';
	record_server_body(document.body, document.body, Array.from(document.body.childNodes));
	const own = document.createElement('div');
	own.innerHTML = '<ogygia-region data-key="portal"></ogygia-region>';
	document.body.append(own);
	capture_region_ids(own.firstElementChild!, () =>
		resolve({ k: 'test-reconcile-owned', i: ID, d: { n: 1 } }, 'page')
	);
	swap_body(document.body, parsed_body('<main><p>next</p></main>'));
	expect(own.isConnected).toBe(true);
	expect(disposed).toEqual([]);
});
