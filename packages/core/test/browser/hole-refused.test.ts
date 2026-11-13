// A HOLE WHOSE ANSWER IS REFUSED is refused for good: no retry would differ, so it asks once, keeps
// its fallback, and says why. A 403 says the server's reason (`region_answer_denied`); a whole
// document (a handle in front of ogygia's answered) says what answered (`region_answer_redirected`).
// A 403 about the server rather than the request (`sig`, `shape`, `foreign-key`: a rolling deploy's
// server of another build) is asked once more first (#1752).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const ep = (id: string) => `/__ogygia__?id=${id}&props=W3t9XQ&exp=9999999999&sig=stub`;
const hole = (endpoint: string) =>
	`<ogygia-region render="defer" when="load" endpoint="${endpoint}"><p data-fallback>loading</p></ogygia-region>`;

const real_fetch = window.fetch;
beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => {
	window.fetch = real_fetch;
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	_reset();
});

test('a hole whose endpoint answers 403 asks once, keeps its fallback, and says the server’s reason', async () => {
	const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
	let asked = 0;
	window.fetch = async () => {
		asked++;
		return new Response('', { status: 403, headers: { 'x-ogygia-deny': 'bad-mac' } });
	};
	const box = document.createElement('div');
	box.innerHTML = hole(ep('forbidden01'));
	const el = box.querySelector<HTMLElement>('ogygia-region')!;
	document.body.append(el);
	bootDev();
	await expect
		.poll(() => said.mock.calls.some((c) => String(c[0]).includes('region_answer_denied')), {
			timeout: 5_000,
			interval: 50
		})
		.toBe(true);
	await new Promise((r) => setTimeout(r, 2_000));
	expect(asked, 'no retry: a refusal is deterministic').toBe(1);
	expect(el.querySelector('[data-fallback]')).not.toBeNull();
});

test('a hole whose endpoint answers a whole document asks once, keeps its fallback, and says what answered', async () => {
	const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
	let asked = 0;
	window.fetch = async () => {
		asked++;
		return new Response(
			'<!doctype html><html><head><title>sign in</title></head><body><p data-wall>sign in</p></body></html>',
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	};
	const box = document.createElement('div');
	box.innerHTML = hole(ep('document01'));
	const el = box.querySelector<HTMLElement>('ogygia-region')!;
	document.body.append(el);
	bootDev();
	await expect
		.poll(() => said.mock.calls.some((c) => String(c[0]).includes('region_answer_redirected')), {
			timeout: 5_000,
			interval: 50
		})
		.toBe(true);
	await new Promise((r) => setTimeout(r, 2_000));
	expect(asked, 'no retry: a refusal is deterministic').toBe(1);
	expect(el.querySelector('[data-wall]')).toBeNull();
	expect(el.querySelector('[data-fallback]')).not.toBeNull();
});

for (const deny of ['sig', 'shape', 'foreign-key']) {
	test(`a hole refused with ${deny} asks once more, since a rolling deploy's other server may answer it (#1752)`, async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		let asked = 0;
		window.fetch = async () => {
			asked++;
			if (asked === 1) return new Response('', { status: 403, headers: { 'x-ogygia-deny': deny } });
			return new Response('<p data-answer>hello</p>', {
				status: 200,
				headers: { 'content-type': 'text/html' }
			});
		};
		const box = document.createElement('div');
		box.innerHTML = hole(ep(`rolling-${deny}`));
		const el = box.querySelector<HTMLElement>('ogygia-region')!;
		document.body.append(el);
		bootDev();
		await expect
			.poll(() => el.querySelector('[data-answer]'), {
				message: 'the second server’s answer',
				timeout: 5_000,
				interval: 50
			})
			.not.toBeNull();
		expect(asked).toBe(2);
	});
}

test('a hole refused with sig twice keeps its fallback and says why, after two asks (#1752)', async () => {
	const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
	let asked = 0;
	window.fetch = async () => {
		asked++;
		return new Response('', { status: 403, headers: { 'x-ogygia-deny': 'sig' } });
	};
	const box = document.createElement('div');
	box.innerHTML = hole(ep('sigtwice01'));
	const el = box.querySelector<HTMLElement>('ogygia-region')!;
	document.body.append(el);
	bootDev();
	await expect.poll(() => asked, { timeout: 5_000, interval: 50 }).toBe(2);
	await expect
		.poll(
			() =>
				said.mock.calls.some(
					(c) => String(c[0]).includes('region_answer_denied') && String(c[0]).includes('sig')
				),
			{ timeout: 5_000, interval: 50 }
		)
		.toBe(true);
	await new Promise((r) => setTimeout(r, 3_000));
	expect(asked, 'one retry, not more').toBe(2);
	expect(el.querySelector('[data-fallback]')).not.toBeNull();
});
