// A KEPT REGION TAKES THE NEXT PAGE'S FINGERPRINT WITH ITS PROPS (#1067, found by the simulator). A
// kept island (`keep: 'name'`) crosses a navigation as the same node, and the next page's props are
// pushed into it. Its `data-og-fp` names those props: the router lists the islands a page holds by
// it (`x-ogygia-known`) and the props sidecar is found by it. A fresh load of the next page has the
// next page's fingerprint there, so the kept node must too.
import { afterEach, expect, test } from 'vitest';
import { morph_children, install as install_morph } from '../../src/runtime/morph.ts';
import { reconcile_body } from '../../src/runtime/reconcile.ts';
import { record_server_body } from '../../src/runtime/ownership.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';

install_morph();
link_boot();

const kept = (fp: string, page: string) =>
	`<ogygia-region entry="./keeper.js" wake="load" data-ogygia-keep="tally-keeper" data-og-fp="${fp}"><p>${page}</p></ogygia-region>`;

function parsed_body(html: string): HTMLElement {
	return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body;
}

afterEach(() => {
	document.body.replaceChildren();
});

test('a kept region carries the next page’s fingerprint after a navigation, as the same node', () => {
	document.body.innerHTML = kept('bf576b6a7249dfcc', 'B');
	record_server_body(document.body, document.body, Array.from(document.body.childNodes));
	const before = document.body.querySelector('ogygia-region')!;
	reconcile_body(document.body, parsed_body(kept('e94aa8af265523c3', 'A')), morph_children);
	const after = document.body.querySelector('ogygia-region')!;
	expect(after).toBe(before);
	expect(after.getAttribute('data-og-fp')).toBe('e94aa8af265523c3');
});
