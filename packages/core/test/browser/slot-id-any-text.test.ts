// A slot snippet finds its slot by the id's exact text (#755): an id with `"` or `]` in it never
// throws, never matches another slot, and never breaks out of the marker it falls back to.
import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { revive_region_snippet } from '../../src/region-snippet.ts';
import RenderSnippet from './fixtures/RenderSnippet.svelte';

let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
afterEach(() => {
	if (app) void unmount(app);
	app = undefined;
	host?.remove();
	document.body.innerHTML = '';
});

/** the page's slots, then what the snippet revived for `id` renders */
function render_slot(id: string): HTMLElement {
	const page = document.createElement('div');
	page.innerHTML =
		'<ogygia-slot data-og-slot="og1">one</ogygia-slot>' +
		'<ogygia-slot data-og-slot="a&quot;]">quoted</ogygia-slot>';
	document.body.appendChild(page);
	const s = revive_region_snippet({ m: 'slot', id });
	host = document.createElement('div');
	document.body.appendChild(host);
	app = mount(RenderSnippet, { target: host, props: { s } });
	flushSync();
	return host;
}

test('a slot id with a quote and a bracket finds its own slot', () => {
	const out = render_slot('a"]');
	expect(out.textContent).toBe('quoted');
});

test('a slot id that would widen a selector matches no other slot', () => {
	const out = render_slot('x"],ogygia-slot[data-og-slot="og1');
	expect(out.textContent).toBe('');
	const marker = out.querySelector('ogygia-slot');
	expect(marker?.getAttribute('data-og-slot')).toBe('x"],ogygia-slot[data-og-slot="og1');
});

test('a slot id with markup in it stays an attribute value', () => {
	const out = render_slot('"><b id="injected">');
	expect(out.querySelector('#injected')).toBeNull();
	expect(out.querySelector('ogygia-slot')?.getAttribute('data-og-slot')).toBe(
		'"><b id="injected">'
	);
});
