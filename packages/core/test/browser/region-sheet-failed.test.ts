// A REGION SHEET THAT FAILED ONCE (#274). An answer's `<link data-ogygia-region-css>` is lifted into
// the head once, and later answers that carry the same sheet find it there. A link whose download
// failed never loads again: nobody asks for the sheet again, so the region stays unstyled for the rest
// of the tab. (Where the failed link has no `sheet`, every later answer also waits the whole 5 s cap
// on it, since it fires no more `load` or `error`. Chromium gives it an empty sheet instead.)
//
// The download fails for real, at the network (the `drop_downloads` command), once. The built
// runtime's path: in dev the sheet is a module, imported instead of linked.
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { region_fragment } from './_html.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const SHEET = '/test/browser/fixtures/region-sheet.css';
const GREEN = 'rgb(0, 128, 0)';
const answer = `<link rel="stylesheet" href="${SHEET}" data-ogygia-region-css><p class="og-region-sheet-probe">answer</p>`;
const sheets = () => document.head.querySelectorAll<HTMLLinkElement>(`link[href="${SHEET}"]`);

let probe: HTMLElement;
beforeEach(() => {
	vi.stubEnv('DEV', false);
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	link_boot();
	for (const l of sheets()) l.remove();
	probe = document.createElement('p');
	probe.className = 'og-region-sheet-probe';
	document.body.appendChild(probe);
});
afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	await commands.keep_downloads(SHEET);
	for (const l of sheets()) l.remove();
	probe.remove();
});

it_with_network_routes(
	'an answer after a failed region sheet fetches it again, and paints styled without the 5 s wait',
	async () => {
		await commands.drop_downloads(SHEET, 1);
		// the first answer: its sheet fails at the network, and the answer paints anyway, unstyled
		await region_fragment(answer).ready;
		expect(sheets()).toHaveLength(1);
		expect(getComputedStyle(probe).color).not.toBe(GREEN);
		// the next answer with the same sheet asks for it again, and paints once it is in: on the
		// sheet's load, never on the 5 s cap (its timer is the test's and never runs, so a wait on the
		// failed link would hang here; a wall clock in its place failed on a loaded runner)
		await region_fragment(answer).ready;
		expect(sheets()).toHaveLength(1);
		expect(getComputedStyle(probe).color).toBe(GREEN);
	}
);

it_with_network_routes(
	'answers that find the sheet still loading wait on that same download',
	async () => {
		const first = region_fragment(answer).ready;
		const second = region_fragment(answer).ready;
		await Promise.all([first, second]);
		expect(sheets()).toHaveLength(1);
		expect(getComputedStyle(probe).color).toBe(GREEN);
	}
);
