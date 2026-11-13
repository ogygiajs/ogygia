// PAGE FACTS WAIT FOR DEVALUE (#1753). An island whose wake started before a hole answered did not
// load devalue (nothing on the page needed it then). When its hydrate ran, the hole's facts had come
// in meanwhile: the hydrate took them off the queue, could not read them (devalue not loaded), and
// dropped them. The island the hole held then woke to a page.data without the keys it reads.
//
// Its own file: whether devalue is loaded is module state shared by a file's tests.
import { expect, test, vi } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { devalue } from '../../src/runtime/devalue-lane.ts';
import { region_fragment } from './_html.ts';
import { prepare_spa_document, seed_page_once } from '../../src/runtime/seeds.ts';
import { boot_link } from '../../src/runtime/slots.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';

test('facts a hole brought before devalue loaded join page.data once it has, never dropped', async () => {
	link_boot();
	document.body.innerHTML = '<p>page</p>';
	prepare_spa_document();
	expect(() => devalue()).toThrow(/devalue_not_loaded/);
	region_fragment(
		`<script type="application/ogygia-page-facts">${stringify({ who: 'hole' })}\x3C/script><p>hole</p>`
	);
	// an island that woke before the answer hydrates now, devalue still not loaded
	seed_page_once();
	// the held island's wake loads devalue, and its hydrate asks again
	await boot_link().load_devalue();
	seed_page_once();
	expect((page_state.data as { who?: string }).who).toBe('hole');
});

test('facts that do not parse are skipped, the readable ones still join, and dev says why', async () => {
	await boot_link().load_devalue();
	seed_page_once();
	const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		region_fragment(
			'<script type="application/ogygia-page-facts">{not devalue\x3C/script><p>mangled</p>'
		);
		region_fragment(
			`<script type="application/ogygia-page-facts">${stringify({ who: 'readable' })}\x3C/script><p>hole</p>`
		);
		seed_page_once();
		expect((page_state.data as { who?: string }).who).toBe('readable');
		expect(said.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain(
			'page_payload_unreadable'
		);
	} finally {
		said.mockRestore();
	}
});
