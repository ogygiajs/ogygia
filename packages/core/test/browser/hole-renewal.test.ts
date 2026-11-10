// A RENEWED CAPABILITY BELONGS TO THE ADDRESS. A hole whose document outlived its capability (a
// cached page) gets a 403, renews once (`&renew=1`), and the handle answers the hole with a fresh
// capability. Two copies of the hole share that one fetch: both answer from it, and both must move
// onto the fresh capability, or the copy that only joined asks with the expired one next time.
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const real_fetch = window.fetch;
afterEach(() => {
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

const EXPIRED = '/__ogygia__?id=renew0000001&props=W3t9XQ&exp=1&sig=old';
const FRESH = '/__ogygia__?id=renew0000001&props=W3t9XQ&exp=9999999999&sig=new';

test('two copies of a hole on one fetch both take the capability its renewal answered', async () => {
	const calls: string[] = [];
	window.fetch = async (input) => {
		const url = String(input);
		calls.push(url);
		if (!url.includes('renew=1')) return new Response('', { status: 403 });
		return new Response('<p data-testid="served">served</p>', {
			status: 200,
			headers: { 'content-type': 'text/html', 'x-ogygia-capability': FRESH }
		});
	};
	document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${EXPIRED}"><p>desktop</p></ogygia-region><ogygia-region render="defer" when="load" endpoint="${EXPIRED}"><p>drawer</p></ogygia-region>`;
	const [desktop, drawer] = Array.from(document.querySelectorAll('ogygia-region'));
	bootDev();
	await expect
		.poll(() => drawer.querySelector('[data-testid="served"]') !== null, { timeout: 5_000 })
		.toBe(true);
	expect(desktop.querySelector('[data-testid="served"]')).not.toBeNull();
	expect(calls, 'one fetch and its renewal, shared by both copies').toHaveLength(2);
	expect(desktop.getAttribute('endpoint')).toBe(FRESH);
	expect(drawer.getAttribute('endpoint'), 'the copy that joined took it too').toBe(FRESH);
});
