// A third party's edit inside a lake, made while the island holding it slept, is still there once the
// island hydrated (`opaque_untouched`, gen `lakeEdit`): it judges only an island the script kept that
// is still in the document and hydrated.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { opaque_untouched } from '../src/oracles.ts';
import type { Tab } from '../src/browser.ts';

function tab_with(html: string): { tab: Tab; region: Element; window: Window } {
	const window = new Window({ url: 'https://app.test/p0' });
	window.document.body.innerHTML = html;
	const region = window.document.querySelector('ogygia-region')! as unknown as Element;
	(window as unknown as { __sim_gen_lake_edits: Element[] }).__sim_gen_lake_edits = [region];
	const tab = {
		page: { mainFrame: { window, url: 'https://app.test/p0', document: window.document } }
	} as unknown as Tab;
	return { tab, region, window };
}

const ISLAND = (mark: string) =>
	`<ogygia-region wake="load"><div data-gen="island" class="g3"><ogygia-region wake="none"><div data-gen="lake">${mark}lake</div></ogygia-region></div></ogygia-region>`;

describe('an edit inside a lake', () => {
	it('kept once its island hydrated is no break', async () => {
		const { tab, region, window } = tab_with(ISLAND('<b data-gen-lake-mark="">third party</b>'));
		region.setAttribute('data-hydrated', '');
		expect(opaque_untouched(tab)).toBeNull();
		await window.happyDOM.close();
	});

	it('undone once its island hydrated breaks the oracle, naming the island', async () => {
		const { tab, region, window } = tab_with(ISLAND(''));
		region.setAttribute('data-hydrated', '');
		expect(opaque_untouched(tab)).toEqual({
			oracle: 'opaque-untouched',
			detail: 'https://app.test/p0: the edit in a lake of g3 was undone'
		});
		await window.happyDOM.close();
	});

	it('is not judged while its island sleeps, nor once the island left the document', async () => {
		const { tab, region, window } = tab_with(ISLAND(''));
		expect(opaque_untouched(tab)).toBeNull();
		region.setAttribute('data-hydrated', '');
		region.remove();
		expect(opaque_untouched(tab)).toBeNull();
		await window.happyDOM.close();
	});
});
