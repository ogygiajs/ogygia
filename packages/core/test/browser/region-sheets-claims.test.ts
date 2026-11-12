// What `runtime/region-sheets.ts` states, against the source, in a real browser: a link that loaded
// before anyone looked counts as loaded; a link whose download fails is failed; a navigation takes
// out an unlisted region sheet only when no connected region's answer uses it (#275).
import { afterEach, expect, it } from 'vitest';
import { connected_regions } from '../../src/runtime/connected.ts';
import { release_sheets, sheet_of, use_sheets } from '../../src/runtime/region-sheets.ts';

const SHEET = '/test/browser/fixtures/region-sheet.css';
const added: Element[] = [];
afterEach(() => {
	for (const el of added.splice(0)) {
		el.remove();
		connected_regions.delete(el);
	}
});

function link(href: string): HTMLLinkElement {
	const l = document.createElement('link');
	l.rel = 'stylesheet';
	l.href = href;
	added.push(l);
	return l;
}

const settled = (l: HTMLLinkElement) =>
	new Promise((r) => {
		l.addEventListener('load', r);
		l.addEventListener('error', r);
	});

it('a link that loaded before anyone looked at it counts as loaded', async () => {
	const l = link(`${SHEET}?before`);
	document.head.appendChild(l);
	await settled(l);
	expect(sheet_of(l).now.kind).toBe('loaded');
});

it('a link watched before it goes in is loading, then loaded', async () => {
	const l = link(`${SHEET}?watched`);
	const s = sheet_of(l);
	expect(s.now.kind).toBe('loading');
	document.head.appendChild(l);
	await settled(l);
	expect(s.now.kind).toBe('loaded');
});

it('a link whose download fails is failed', async () => {
	const l = link('/test/browser/fixtures/no-such-sheet.css');
	const s = sheet_of(l);
	document.head.appendChild(l);
	await settled(l);
	expect(s.now.kind).toBe('failed');
});

it('a navigation keeps an unlisted region sheet a connected region uses, and takes out the rest', () => {
	const kept = link(`${SHEET}?kept`);
	const gone = link(`${SHEET}?gone`);
	document.head.append(kept, gone);
	const region = document.createElement('ogygia-region');
	added.push(region);
	connected_regions.add(region);
	use_sheets(region, [kept]);
	release_sheets([kept, gone]);
	expect(kept.isConnected).toBe(true);
	expect(gone.isConnected).toBe(false);
});

it('a region whose new answer stops using a sheet lets it go', () => {
	const l = link(`${SHEET}?swapped`);
	document.head.append(l);
	const region = document.createElement('ogygia-region');
	added.push(region);
	connected_regions.add(region);
	use_sheets(region, [l]);
	use_sheets(region, []);
	release_sheets([l]);
	expect(l.isConnected).toBe(false);
});
