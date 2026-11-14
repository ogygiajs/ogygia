// THE DEVALUE QUESTION, ASKED ONCE (runtime/core.ts `document_needs_devalue`): a page of JSON-lane
// scripts asks its document whether a devalue-lane script is in it once, not once per waking island
// (that query of the whole document per wake was islands × the page's elements). Markup that comes in
// later (a region with its sidecar beside it, as a hole answer or a fragment brings it) is asked about
// again, so its devalue-lane sidecar still finds devalue loaded.
//
// Its own file: whether devalue is loaded is module state shared by a file's tests.
import { expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { devalue } from '../../src/runtime/devalue-lane.ts';
import { scope } from '@ogygia/machine';
import { patch } from '../_patch.ts';

const decode = (key: 'counter_tail_ssr_b64' | 'counter_json_lane_ssr_b64') => from_b64(inject(key));

const HYDRATED = 'ogygia-region[data-hydrated]';
const LANE_QUERY = 'application/ogygia-page-facts';

test('one document query for the page, another only when markup comes in', async () => {
	// the JSON-lane counter, and copies of it (the same fingerprint: they share its one sidecar)
	const json = decode('counter_json_lane_ssr_b64');
	const region = json.slice(0, json.indexOf('</ogygia-region>') + '</ogygia-region>'.length);
	document.body.innerHTML = region.repeat(5) + json;

	let asked = 0;
	const proto = Document.prototype as { querySelector: (selector: string) => Element | null };
	const spies = scope();
	patch(
		spies,
		proto,
		'querySelector',
		(query) =>
			function (this: Document, selector: string) {
				if (selector.includes(LANE_QUERY)) asked++;
				return query.call(this, selector);
			}
	);
	try {
		bootDev();
		await expect
			.poll(() => document.querySelectorAll(HYDRATED).length, { timeout: 10_000 })
			.toBe(6);
		expect(asked).toBe(1);
		expect(() => devalue()).toThrow(/devalue_not_loaded/); // a JSON page never loads it

		// a late region whose sidecar is in the devalue lane comes in beside it
		const late = document.createElement('div');
		late.innerHTML = decode('counter_tail_ssr_b64');
		document.body.append(late);
		await expect
			.poll(() => document.querySelectorAll(HYDRATED).length, { timeout: 10_000 })
			.toBe(7);
		expect(asked).toBe(2);
		expect(() => devalue()).not.toThrow();

		// once the answer is yes, devalue is loading: no wake asks again
		const more = document.createElement('div');
		more.innerHTML = region;
		document.body.append(more);
		await expect
			.poll(() => document.querySelectorAll(HYDRATED).length, { timeout: 10_000 })
			.toBe(8);
		expect(asked).toBe(2);
	} finally {
		spies.close();
	}
});
