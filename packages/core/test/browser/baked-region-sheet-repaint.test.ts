// A BAKED HELD REGION REPAINTED WITH ITS OWN STYLES KEEPS THEM (found by the simulator: gen 25,
// /p3, a held region inside an island whose query the island reads again). The server writes the
// region's sheet as a `<link data-ogygia-region-css>` inside the baked region (#1039). The next
// answer carries the same sheet: the answer's links are lifted to the head, and the morph takes the
// in-region link out as the last render's output. A lift that counted the in-region link as the
// head's own kept no head link, so the morph left the region with no rules at all.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { morph_children, install as install_morph } from '../../src/runtime/morph.ts';
import { region_fragment } from './_html.ts';

install_morph();

const HREF = 'data:text/css,.g14-repaint%7Bborder-left%3A3px%20solid%7D';
const SHEET = `<link rel="stylesheet" href="${HREF}" data-ogygia-region-css="">`;
const sheets = () =>
	[...document.querySelectorAll('link[rel="stylesheet"]')].filter(
		(l) => l.getAttribute('href') === HREF
	);

beforeEach(() => {
	vi.stubEnv('DEV', false);
	link_boot();
});
afterEach(() => {
	vi.unstubAllEnvs();
	for (const l of sheets()) l.remove();
	document.body.replaceChildren();
});

test('a baked region repainted with the same sheet still has that sheet in the document', async () => {
	document.body.innerHTML = `<ogygia-region live="" data-og-baked="">${SHEET}<!--[--><div class="g14-repaint"><span>n14 #0</span></div><!--]--></ogygia-region>`;
	const live = document.body.firstElementChild!;
	const baked = live.querySelector('link')!;
	await expect.poll(() => (baked as HTMLLinkElement).sheet !== null).toBe(true);
	const { frag, ready } = region_fragment(
		`${SHEET}<!--[--><div class="g14-repaint"><span>n14 #1</span></div><!--]-->`
	);
	await ready;
	morph_children(live, Array.from(frag.childNodes));
	expect(live.querySelector('span')?.textContent).toBe('n14 #1');
	expect(sheets().length).toBe(1);
	expect(sheets()[0]!.isConnected).toBe(true);
});
