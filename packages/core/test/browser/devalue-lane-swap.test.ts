// Its own file: whether devalue is loaded is module state shared by a file's tests.
import { expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { stringify } from 'devalue';
import { bootDev } from '../../src/runtime/full.ts';
import { devalue } from '../../src/runtime/devalue-lane.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { TEST_MARK_ATTR } from './_response-mark.ts';

const hydrated = () => document.querySelectorAll('ogygia-region[data-hydrated]').length;

test('a page swapped in with a devalue-lane seed is asked about again, though no region connected', async () => {
	const json = from_b64(inject('counter_json_lane_ssr_b64'));
	const region = json.slice(0, json.indexOf('</ogygia-region>') + '</ogygia-region>'.length);
	document.body.innerHTML = region.replace('wake="load"', 'wake="interaction"') + json;
	bootDev();
	await expect.poll(hydrated, { timeout: 10_000 }).toBe(1);
	expect(() => devalue()).toThrow(/devalue_not_loaded/);

	// the router's swap: the next page's visit, its seed in devalue's lane, the island still cold
	runtime_session.reset();
	document.querySelector('script[type="application/ogygia-page"]')!.remove();
	document.body.insertAdjacentHTML(
		'beforeend',
		`<script type="application/ogygia-page" data-ogygia-page${TEST_MARK_ATTR}>${stringify({
			url: location.href,
			params: {},
			route: { id: '/' },
			status: 200,
			data: { greeting: 'devalue seed' }
		})}\x3C/script>`
	);
	document.dispatchEvent(new Event('og:after-swap'));

	const cold = document.querySelector('ogygia-region:not([data-hydrated])') as HTMLElement;
	cold.querySelector('button')!.click();
	await expect.poll(hydrated, { timeout: 10_000 }).toBe(2);
	expect(() => devalue()).not.toThrow();
});
