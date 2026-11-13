import { afterEach, expect, test, vi } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const ep = (id: string, extra = '') =>
	`/__ogygia__?id=${id}&props=W3t9XQ${extra}&exp=9999999999&sig=stub`;
const hole = (endpoint: string, when = 'load') =>
	`<ogygia-region render="defer" when="${when}" endpoint="${endpoint}"><p data-fallback>loading</p></ogygia-region>`;
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const answer = (html = '<p data-answer>answer</p>') =>
	new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

const real_fetch = window.fetch;
afterEach(() => {
	window.fetch = real_fetch;
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	_reset();
});

test('a hole whose endpoint is on another origin is never fetched or retried, and dev says region_endpoint_foreign', async () => {
	const asked: string[] = [];
	window.fetch = async (input) => {
		asked.push(String(input));
		return answer();
	};
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const endpoint = `https://elsewhere.example.com${ep('foreign0001')}`;
	document.body.innerHTML = hole(endpoint);
	bootDev();
	await tick(1_600);
	expect(asked).toEqual([]);
	expect(document.querySelector('[data-fallback]')).not.toBeNull();
	const said = warn.mock.calls.map((c) => c.map(String).join(' '));
	expect(said.filter((l) => l.includes('region_endpoint_foreign'))).toHaveLength(1);
	expect(said.join('\n')).not.toContain('region_fetch_failed');
});

test('a cacheable hole (ttl) asks on its own GET while the holes beside it share one batch', async () => {
	const posts: string[][] = [];
	const gets: string[] = [];
	window.fetch = async (input, init) => {
		if (init?.method === 'POST') {
			posts.push(JSON.parse(String(init.body)) as string[]);
			return new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });
		}
		gets.push(String(input));
		return answer();
	};
	const cached = ep('ttlhole0001', '&ttl=60');
	document.body.innerHTML = [hole(ep('plainhole01')), hole(ep('plainhole02')), hole(cached)].join(
		''
	);
	bootDev();
	await expect.poll(() => posts.length, { timeout: 5_000 }).toBe(1);
	expect(posts[0]).toEqual([ep('plainhole01'), ep('plainhole02')]);
	await expect
		.poll(() => gets.some((g) => g.includes('ttlhole0001')), { timeout: 5_000 })
		.toBe(true);
});

test('a hole whose capability expired asks on its own GET while the holes beside it share one batch', async () => {
	const posts: string[][] = [];
	const gets: string[] = [];
	window.fetch = async (input, init) => {
		if (init?.method === 'POST') {
			posts.push(JSON.parse(String(init.body)) as string[]);
			return new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });
		}
		gets.push(String(input));
		return answer();
	};
	const expired = '/__ogygia__?id=expiredhole1&props=W3t9XQ&exp=1&sig=stub';
	document.body.innerHTML = [hole(ep('plainhole03')), hole(ep('plainhole04')), hole(expired)].join(
		''
	);
	bootDev();
	await expect.poll(() => posts.length, { timeout: 5_000 }).toBe(1);
	expect(posts[0]).toEqual([ep('plainhole03'), ep('plainhole04')]);
	await expect
		.poll(() => gets.some((g) => g.includes('expiredhole1')), { timeout: 5_000 })
		.toBe(true);
});

test('dev says each failed hole fetch, not only the last', async () => {
	let calls = 0;
	window.fetch = async () => (++calls === 1 ? new Response('', { status: 500 }) : answer());
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	document.body.innerHTML = hole(ep('warnfirst01'));
	bootDev();
	await expect
		.poll(() => document.querySelector('[data-answer]') !== null, { timeout: 5_000 })
		.toBe(true);
	expect(warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain(
		'region_fetch_failed'
	);
});

test('an answered hole taken out and put back asks nothing again', async () => {
	let calls = 0;
	window.fetch = async () => {
		calls++;
		return answer();
	};
	document.body.innerHTML = hole(ep('oneshot0001'));
	const el = document.querySelector('ogygia-region')!;
	bootDev();
	await expect
		.poll(() => el.querySelector('[data-answer]') !== null, { timeout: 5_000 })
		.toBe(true);
	el.remove();
	await tick();
	document.body.append(el);
	await tick(300);
	expect(calls).toBe(1);
});
