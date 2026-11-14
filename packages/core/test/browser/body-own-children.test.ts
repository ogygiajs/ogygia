// `<body>` HAS TWO OWNERS (runtime/ownership.ts `record_server_body`, runtime/reconcile.ts): a
// navigation replaces the server's children and attributes with the next page's, and leaves what the
// page's own scripts put there.
//
// REGRESSION: a popover in an island that a navigation KEEPS (same fingerprint on the next page, so
// the live island stays) stopped opening after that navigation, with no error. Its portal had
// mounted into `<body>` at hydrate, which leaves an anchor node there; the body morph removed every
// body child the next page's HTML did not have, the anchor too, so opening inserted the popover
// beside a detached node.
import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { morph_children, install as install_morph } from '../../src/runtime/morph.ts';
import { reconcile_body, swap_body } from '../../src/runtime/reconcile.ts';
import { record_server_body } from '../../src/runtime/ownership.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import BodyPortal from './fixtures/BodyPortal.svelte';

// the reconcile reaches morph's attribute sync and the body record through the registry, as the
// boot links them
install_morph();
link_boot();

let app: ReturnType<typeof mount> | null = null;
afterEach(async () => {
	if (app) await unmount(app);
	app = null;
	document.body.replaceChildren();
	for (const a of Array.from(document.body.attributes)) document.body.removeAttribute(a.name);
});

function parsed_body(html: string): HTMLElement {
	return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body;
}

/** A page as the server sent it, the router's record taken, then a portal mounted into the body. */
function boot_page(html: string): { show: () => void } {
	document.body.innerHTML = html;
	record_server_body(document.body, document.body, Array.from(document.body.childNodes)); // the router's start
	const instance = mount(BodyPortal, { target: document.body });
	app = instance;
	return instance as unknown as { show: () => void };
}

test('a navigation keeps a portal mounted into <body>: it still opens afterwards', () => {
	const portal = boot_page('<main><p>page one</p></main><footer>shell</footer>');
	reconcile_body(
		document.body,
		parsed_body('<main><p>page two</p></main><footer>shell</footer>'),
		morph_children
	);
	expect(document.querySelector('main')!.textContent).toBe('page two');

	portal.show();
	flushSync();
	const popover = document.querySelector('[data-testid="popover"]');
	expect(popover).not.toBeNull();
	expect(popover!.isConnected).toBe(true);
});

test("the server's children are replaced, the page's own stay, across several navigations", () => {
	boot_page('<main>one</main><aside>only on page one</aside>');
	// a script appends a node of its own (a toast host)
	const toast = document.createElement('div');
	toast.id = 'toasts';
	document.body.append(toast);

	reconcile_body(document.body, parsed_body('<main>two</main>'), morph_children);
	expect(document.querySelector('aside')).toBeNull(); // the server stopped sending it
	expect(document.querySelector('main')!.textContent).toBe('two');
	expect(toast.isConnected).toBe(true);

	// the next page's server nodes are the server's now: page three replaces them in turn
	reconcile_body(document.body, parsed_body('<section>three</section>'), morph_children);
	expect(document.querySelector('main')).toBeNull();
	expect(document.querySelector('section')!.textContent).toBe('three');
	expect(toast.isConnected).toBe(true);
});

test("only the server's body attributes move; one a script set stays", () => {
	document.body.setAttribute('class', 'theme-a');
	boot_page('<main>one</main>');
	document.body.setAttribute('data-scroll-lock', ''); // the page's own (a modal's lock)

	reconcile_body(document.body, parsed_body('<main>two</main>'), morph_children);
	expect(document.body.hasAttribute('class')).toBe(false); // the server stopped sending it
	expect(document.body.hasAttribute('data-scroll-lock')).toBe(true);
});

test('another root (a harness driving the reconcile on its own) follows the same record', () => {
	boot_page('<main>page</main>');
	const root = document.createElement('div');
	root.setAttribute('class', 'lens'); // the harness's own
	root.innerHTML = '<p>one</p><p>stale</p>';
	document.querySelector('main')!.append(root);
	// its first reconcile: no record yet, so every child is the render's; nothing is taken away
	reconcile_body(root, parsed_body('<p>two</p>'), morph_children);
	expect(root.innerHTML).toBe('<p>two</p>');
	expect(root.getAttribute('class')).toBe('lens');

	// from then on its record decides, as the body's does
	const own = document.createElement('i');
	root.append(own);
	const sent = parsed_body('<p>three</p>');
	sent.setAttribute('data-page', 'three');
	reconcile_body(root, sent, morph_children);
	reconcile_body(root, parsed_body('<p>four</p>'), morph_children);
	expect(root.querySelector('p')!.textContent).toBe('four');
	expect(own.isConnected).toBe(true);
	expect(root.hasAttribute('data-page')).toBe(false); // the render's, gone with its page
	expect(root.getAttribute('class')).toBe('lens');
});

test('the fallback body swap keeps the page’s own children too', () => {
	const portal = boot_page('<main>one</main>');
	swap_body(document.body, parsed_body('<main>two</main>'));
	expect(document.querySelector('main')!.textContent).toBe('two');
	portal.show();
	flushSync();
	expect(document.querySelector('[data-testid="popover"]')?.isConnected).toBe(true);
});
